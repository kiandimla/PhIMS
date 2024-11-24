const express = require('express');
const app = express();

const mysql = require('mysql2');

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'admin',
    database: 'PhIMS'
});

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to the database:', err);
        return;
    }
    console.log('Connected to the database.');
});

module.exports = connection;

app.use('/stylesheets', express.static(__dirname + '/stylesheets'));
app.use('/images', express.static(__dirname + '/images'));
app.use('/scripts', express.static(__dirname + '/scripts'));
app.use(express.static(__dirname));

const path = require('path');

const hbs = require('hbs');
app.set('view engine','hbs');

app.use(express.json()); 
app.use(express.urlencoded({extended: true})); 
app.use(express.static('public'));

hbs.registerHelper("if", function (v1, v2, options) {
    return v1 === v2 ? options.fn(this) : options.inverse(this);
});

hbs.registerHelper("ifNot", function (v1, v2, options) {
    return v1 !== v2 ? options.fn(this) : options.inverse(this);
});

hbs.registerHelper("arrayLength", function (array) {
    return array ? array.length : 0;
});

hbs.registerHelper('isLast', function(index, array, options) {
    if (index === array.length - 1) {
        return options.fn(this); 
    } else {
        return options.inverse(this); 
    }
});

///////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// App stuff
//
///////////////////////////////////////////////////////////////////////////////////////////////////////////////

var user, status;
var lastDeliverySi, lastDate, lastPageNum;
var lastSaleSi;
var deliverySaved;
let plu = []; 

function initializePLU() {
    connection.query('SELECT * FROM PLU ORDER BY itemName', (err, results) => {
        if (err) {
            console.error('Error fetching data from PLU table:', err);
            return;
        }
        plu = results;
        // console.log('PLU data initialized:', plu);
    });
}

initializePLU();

app.get('/inventory', async function(req, res) {
    if (!user) return res.redirect('/');
    try {
        const query = `
            SELECT 
                inventory.itemId,
                inventory.itemName,
                inventory.quantity,
                PLU.price,
                PLU.cost,
                ROUND((PLU.price - PLU.cost), 2) AS markup,
                ROUND(((PLU.price - PLU.cost) / PLU.cost * 100), 2) AS markupPercent
            FROM inventory
            INNER JOIN PLU ON inventory.itemId = PLU.itemId
            WHERE inventory.quantity > 0
            ORDER BY inventory.quantity DESC;
        `;

        connection.query(query, (err, results) => {
            if (err) {
                console.error('Error fetching data from joined PLU and inventory tables:', err);
                return;
            }
            const inventory = results;
            res.render('inventory', { user, inventory });
        });
    } catch (error) {
        res.redirect('/');
        console.error('Unexpected error:', error);
    }
});

app.post('/reports', async function (req, res) {
    if (!user) return res.redirect('/');

    try {
        const reportFormData = req.body;

        function reformatDate(dateStr) {
            const [year, month, day] = dateStr.split('-');
            return `${month}/${day}/${year}`;
        }

        if (reportFormData['start-date']) {
            reportFormData['start-date'] = reformatDate(reportFormData['start-date']);
        }
        if (reportFormData['end-date']) {
            reportFormData['end-date'] = reformatDate(reportFormData['end-date']);
        }

        let type = reportFormData['report-type'];
        let aggregate = reportFormData['report-aggregate'];
        let start = reportFormData['start-date'];
        let end = reportFormData['end-date'];

        console.log(reportFormData);

        if (type === 'Sales') {
            let groupByClause, selectAdditionalField, dateFormat;
        
            switch (aggregate) {
                case 'Daily':
                    groupByClause = "`date`";
                    selectAdditionalField = "`date` AS `DateRange`";
                    dateFormat = "`date`";
                    break;
                case 'Weekly':
                    groupByClause = "YEAR(STR_TO_DATE(`date`, '%m/%d/%Y')), WEEK(STR_TO_DATE(`date`, '%m/%d/%Y'))";
                    selectAdditionalField = `
                        CONCAT(
                            DATE_FORMAT(MIN(STR_TO_DATE(\`date\`, '%m/%d/%Y')), '%m/%d/%Y'),
                            ' - ',
                            DATE_FORMAT(MAX(STR_TO_DATE(\`date\`, '%m/%d/%Y')), '%m/%d/%Y')
                        ) AS \`DateRange\``;
                    dateFormat = "MIN(STR_TO_DATE(`date`, '%m/%d/%Y'))";
                    break;
                case 'Monthly':
                    groupByClause = "DATE_FORMAT(STR_TO_DATE(`date`, '%m/%d/%Y'), '%m/%Y')";
                    selectAdditionalField = `
                        DATE_FORMAT(STR_TO_DATE(\`date\`, '%m/%d/%Y'), '%m/%Y') AS \`DateRange\``;
                    dateFormat = "DATE_FORMAT(STR_TO_DATE(`date`, '%m/%d/%Y'), '%m/%Y')";
                    break;
                case 'Yearly':
                    groupByClause = "DATE_FORMAT(STR_TO_DATE(`date`, '%m/%d/%Y'), '%Y')";
                    selectAdditionalField = `
                        DATE_FORMAT(STR_TO_DATE(\`date\`, '%m/%d/%Y'), '%Y') AS \`DateRange\``;
                    dateFormat = "DATE_FORMAT(STR_TO_DATE(`date`, '%m/%d/%Y'), '%Y')";
                    break;
                default:
                    return res.status(400).send('Unsupported aggregation type');
            }
        
            const sql = `
                SELECT 
                    ${selectAdditionalField},
                    COUNT(DISTINCT \`invoiceNum\`) AS \`TotalInvoices\`,
                    SUM(\`quantity\`) AS \`TotalQuantitySold\`,
                    ROUND(SUM(DISTINCT \`saleTotal\`) + SUM((\`price\` * \`quantity\`) * (\`discountPercent\` / 100)), 2) AS \`GrossSales\`,
                    ROUND(SUM((\`price\` * \`quantity\`) * (\`discountPercent\` / 100)), 2) AS \`TotalDiscounts\`,
                    ROUND(SUM(DISTINCT \`saleTotal\`), 2) AS \`NetSales\`
                FROM 
                    \`PhIMS\`.\`sales\`
                WHERE 
                    STR_TO_DATE(\`date\`, '%m/%d/%Y') BETWEEN STR_TO_DATE(?, '%m/%d/%Y') 
                                                            AND STR_TO_DATE(?, '%m/%d/%Y')
                GROUP BY 
                    ${groupByClause}
                ORDER BY 
                    ${dateFormat} ASC;
            `;
        
            connection.query(sql, [start, end], (error, results) => {
                if (error) {
                    console.error('Error executing Sales query:', error);
                    return res.status(500).send('Error generating report');
                }

                const columns = [
                    { name: 'Date Range', class: 'string' },
                    { name: 'Total Invoices', class: 'int' },
                    { name: 'Total Quantity Sold', class: 'int' },
                    { name: 'Gross Sales', class: 'number' },
                    { name: 'Total Discounts', class: 'number' },
                    { name: 'Net Sales', class: 'number' }
                ];


                res.render('reports', { user, results, aggregate, type, start, end, columns });
            });
        } else if (type === 'Deliveries') {
            const sql = `
                SELECT 
                    itemId,
                    itemName,
                    SUM(quantity) AS TotalQuantity,
                    SUM(cost * quantity) AS TotalCost
                FROM 
                    phims.deliveries
                WHERE 
                    STR_TO_DATE(date, '%m/%d/%Y') BETWEEN STR_TO_DATE(?, '%m/%d/%Y') 
                                                    AND STR_TO_DATE(?, '%m/%d/%Y')
                GROUP BY 
                    itemId, itemName
                ORDER BY 
                    TotalQuantity DESC;
            `;

            connection.query(sql, [start, end], (error, results) => {
                if (error) {
                    console.error('Error executing Deliveries query:', error);
                    return res.status(500).send('Error generating deliveries report');
                }

                const columns = [
                    { name: 'Item ID', class: 'string' },
                    { name: 'Item Name', class: 'string' },
                    { name: 'Total Quantity', class: 'int' },
                    { name: 'Total Cost', class: 'number' },
                ];

                console.log('Deliveries Query Results:', results);

                res.render('reports', { user, results, aggregate, type, start, end, columns });
            });
        } else if (type === 'Item Performance') {
            const sql = `
                SELECT 
                    itemId,
                    itemName,
                    ROUND(SUM(quantity), 2) AS TotalQuantitySold,
                    ROUND(SUM(price * quantity), 2) AS GrossSales,
                    ROUND(SUM(
                        CASE 
                            WHEN isDiscounted = 1 THEN (price * quantity * discountPercent / 100)
                            ELSE 0
                        END
                    ), 2) AS TotalDiscounts,
                    ROUND(SUM(
                        CASE 
                            WHEN isDiscounted = 1 THEN (price * quantity) - (price * quantity * discountPercent / 100)
                            ELSE (price * quantity)
                        END
                    ), 2) AS NetSales
                FROM 
                    phims.sales
                WHERE 
                    STR_TO_DATE(date, '%m/%d/%Y') BETWEEN STR_TO_DATE(?, '%m/%d/%Y') 
                                                    AND STR_TO_DATE(?, '%m/%d/%Y')
                GROUP BY 
                    itemId, itemName
                ORDER BY 
                    TotalQuantitySold DESC;
            `;

            connection.query(sql, [start, end], (error, results) => {
                if (error) {
                    console.error('Error executing Item Performance query:', error);
                    return res.status(500).send('Error generating item performance report');
                }

                const columns = [
                    { name: 'Item ID', class: 'string' },
                    { name: 'Item Name', class: 'string' },
                    { name: 'Total Quantity Sold', class: 'int' },
                    { name: 'Gross Sales', class: 'number' },
                    { name: 'Total Discounts', class: 'number' },
                    { name: 'Net Sales', class: 'number' },
                ];

                console.log('Item Performance Query Results:', results);

                res.render('reports', { user, results, aggregate, type, start, end, columns });
            });
        } else if (type === 'Stock Card') {
            let groupByClause, selectAdditionalField, dateFormat;
        
            switch (aggregate) {
                case 'Daily':
                    groupByClause = "`MovementDate`";
                    selectAdditionalField = "`MovementDate` AS `DateRange`";
                    dateFormat = "`MovementDate`";
                    break;
                case 'Weekly':
                    groupByClause = "YEAR(STR_TO_DATE(`MovementDate`, '%m/%d/%Y')), WEEK(STR_TO_DATE(`MovementDate`, '%m/%d/%Y'))";
                    selectAdditionalField = `
                        CONCAT(
                            DATE_FORMAT(MIN(STR_TO_DATE(\`MovementDate\`, '%m/%d/%Y')), '%m/%d/%Y'),
                            ' - ',
                            DATE_FORMAT(MAX(STR_TO_DATE(\`MovementDate\`, '%m/%d/%Y')), '%m/%d/%Y')
                        ) AS \`DateRange\``;
                    dateFormat = "MIN(STR_TO_DATE(`MovementDate`, '%m/%d/%Y'))";
                    break;
                case 'Monthly':
                    groupByClause = "DATE_FORMAT(STR_TO_DATE(`MovementDate`, '%m/%d/%Y'), '%m/%Y')";
                    selectAdditionalField = `
                        DATE_FORMAT(STR_TO_DATE(\`MovementDate\`, '%m/%Y')) AS \`DateRange\``;
                    dateFormat = "DATE_FORMAT(STR_TO_DATE(`MovementDate`, '%m/%Y'))";
                    break;
                case 'Yearly':
                    groupByClause = "DATE_FORMAT(STR_TO_DATE(`MovementDate`, '%m/%d/%Y'), '%Y')";
                    selectAdditionalField = `
                        DATE_FORMAT(STR_TO_DATE(\`MovementDate\`, '%Y')) AS \`DateRange\``;
                    dateFormat = "DATE_FORMAT(STR_TO_DATE(`MovementDate`, '%Y'))";
                    break;
                default:
                    return res.status(400).send('Unsupported aggregation type');
            }
        
            const sql = `
                WITH StockMovements AS (
                    SELECT
                        i.itemId,
                        i.itemName,
                        d.date AS MovementDate,
                        'Delivery' AS MovementType,
                        d.quantity AS Quantity
                    FROM
                        deliveries d
                        JOIN inventory i ON i.itemId = d.itemId
        
                    UNION ALL
        
                    SELECT
                        i.itemId,
                        i.itemName,
                        s.date AS MovementDate,
                        'Sale' AS MovementType,
                        -s.quantity AS Quantity
                    FROM
                        sales s
                        JOIN inventory i ON i.itemId = s.itemId
                )
                SELECT
                    sm.itemId AS itemId,
                    sm.itemName AS itemName,
                    ${selectAdditionalField},
                    sm.MovementType AS MovementType,
                    SUM(sm.Quantity) AS Quantity
                FROM
                    StockMovements sm
                WHERE
                    STR_TO_DATE(sm.MovementDate, '%m/%d/%Y') BETWEEN STR_TO_DATE(?, '%m/%d/%Y') 
                                                                AND STR_TO_DATE(?, '%m/%d/%Y')
                GROUP BY
                    sm.itemId, sm.itemName, ${groupByClause}, sm.MovementType
                ORDER BY
                    sm.itemId, ${dateFormat} DESC, sm.MovementType DESC;
            `;
        
            connection.query(sql, [start, end], (error, results) => {
                if (error) {
                    console.error('Error executing Stock Card query:', error);
                    return res.status(500).send('Error generating stock card report');
                }
        
                const groupedResults = results.reduce((acc, row) => {
                    acc[row.itemName] = acc[row.itemName] || [];
                    acc[row.itemName].push({
                        DateRange: row.DateRange,
                        MovementType: row.MovementType,
                        Quantity: row.Quantity,
                    });
                    return acc;
                }, {});
        
                const columns = [
                    { name: 'Date Range', class: 'string' },
                    { name: 'Movement Type', class: 'string' },
                    { name: 'Quantity', class: 'int' },
                ];
        
                console.log('Results:', results);
                console.log('GroupedResults:', groupedResults);
        
                res.render('reports', { user, groupedResults, aggregate, type, start, end, columns });
            });
        } else if (type === 'Item Aging') {
            const sql = `
                WITH DeliveriesAndSales AS (
                    SELECT
                        d.itemId,
                        d.date AS deliveryDate,
                        d.quantity AS deliveredQuantity,
                        IFNULL(SUM(s.quantity), 0) AS soldQuantity,
                        GREATEST(d.quantity - IFNULL(SUM(s.quantity), 0), 0) AS remainingQuantity -- Prevent negative values
                    FROM
                        phims.deliveries d
                    LEFT JOIN phims.sales s ON d.itemId = s.itemId AND s.date >= d.date
                    GROUP BY
                        d.itemId, d.date, d.quantity
                )
                SELECT
                    i.itemId,
                    i.itemName,
                    i.quantity AS totalQuantity, -- Current stock directly from inventory
                    ROUND(AVG(DATEDIFF(CURDATE(), STR_TO_DATE(d.deliveryDate, '%m/%d/%Y'))), 2) AS avgInventoryAge,
                    SUM(
                        CASE
                            WHEN DATEDIFF(CURDATE(), STR_TO_DATE(d.deliveryDate, '%m/%d/%Y')) BETWEEN 1 AND 30
                            THEN d.remainingQuantity -- Remaining quantity after sales
                            ELSE 0
                        END
                    ) AS aged1to30,
                    SUM(
                        CASE
                            WHEN DATEDIFF(CURDATE(), STR_TO_DATE(d.deliveryDate, '%m/%d/%Y')) BETWEEN 31 AND 60
                            THEN d.remainingQuantity -- Remaining quantity after sales
                            ELSE 0
                        END
                    ) AS aged31to60,
                    SUM(
                        CASE
                            WHEN DATEDIFF(CURDATE(), STR_TO_DATE(d.deliveryDate, '%m/%d/%Y')) BETWEEN 61 AND 90
                            THEN d.remainingQuantity -- Remaining quantity after sales
                            ELSE 0
                        END
                    ) AS aged61to90,
                    SUM(
                        CASE
                            WHEN DATEDIFF(CURDATE(), STR_TO_DATE(d.deliveryDate, '%m/%d/%Y')) > 91
                            THEN d.remainingQuantity -- Remaining quantity after sales
                            ELSE 0
                        END
                    ) + (
                        i.quantity - (
                            SUM(
                                CASE
                                    WHEN DATEDIFF(CURDATE(), STR_TO_DATE(d.deliveryDate, '%m/%d/%Y')) BETWEEN 1 AND 30
                                    THEN d.remainingQuantity
                                    ELSE 0
                                END
                            ) +
                            SUM(
                                CASE
                                    WHEN DATEDIFF(CURDATE(), STR_TO_DATE(d.deliveryDate, '%m/%d/%Y')) BETWEEN 31 AND 60
                                    THEN d.remainingQuantity
                                    ELSE 0
                                END
                            ) +
                            SUM(
                                CASE
                                    WHEN DATEDIFF(CURDATE(), STR_TO_DATE(d.deliveryDate, '%m/%d/%Y')) BETWEEN 61 AND 90
                                    THEN d.remainingQuantity
                                    ELSE 0
                                END
                            ) +
                            SUM(
                                CASE
                                    WHEN DATEDIFF(CURDATE(), STR_TO_DATE(d.deliveryDate, '%m/%d/%Y')) > 91
                                    THEN d.remainingQuantity
                                    ELSE 0
                                END
                            )
                        )
                    ) AS agedOver91,
                    i.quantity - (
                        SUM(
                            CASE
                                WHEN DATEDIFF(CURDATE(), STR_TO_DATE(d.deliveryDate, '%m/%d/%Y')) BETWEEN 1 AND 30
                                THEN d.remainingQuantity
                                ELSE 0
                            END
                        ) +
                        SUM(
                            CASE
                                WHEN DATEDIFF(CURDATE(), STR_TO_DATE(d.deliveryDate, '%m/%d/%Y')) BETWEEN 31 AND 60
                                THEN d.remainingQuantity
                                ELSE 0
                            END
                        ) +
                        SUM(
                            CASE
                                WHEN DATEDIFF(CURDATE(), STR_TO_DATE(d.deliveryDate, '%m/%d/%Y')) BETWEEN 61 AND 90
                                THEN d.remainingQuantity
                                ELSE 0
                            END
                        ) +
                        SUM(
                            CASE
                                WHEN DATEDIFF(CURDATE(), STR_TO_DATE(d.deliveryDate, '%m/%d/%Y')) > 91
                                THEN d.remainingQuantity
                                ELSE 0
                            END
                        )
                    ) AS untrackedStock
                FROM
                    phims.inventory i
                LEFT JOIN DeliveriesAndSales d ON i.itemId = d.itemId
                GROUP BY
                    i.itemId, i.itemName, i.quantity
                HAVING
                    avgInventoryAge IS NOT NULL -- Filter to only include rows where avgInventoryAge is not NULL
                ORDER BY
                    avgInventoryAge DESC;
            `;

            connection.query(sql, [], (error, results) => {
                if (error) {
                    console.error('Error executing Item Aging query:', error);
                    return res.status(500).send('Error generating item aging report');
                }

                const columns = [
                    { name: 'Item ID', class: 'string' },
                    { name: 'Item Name', class: 'string' },
                    { name: 'Quantity', class: 'int' },
                    { name: 'Avg Age (days)', class: 'number' },
                    { name: '1-30', class: 'int' },
                    { name: '31-60', class: 'int' },
                    { name: '61-90', class: 'int' },
                    { name: '(> 91', class: 'int' },
                    { name: 'Untracked)', class: 'int' }
                ];

                console.log('Item Aging Query Results:', results);

                res.render('reports', { user, results, aggregate, type, columns });
            });
        } else {
            res.status(400).send('Unsupported report type');
        }
              
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('Unexpected error occurred');
    }
});

app.get('/generate-reports', async function(req, res) {
    if (!user) return res.redirect('/');
    try {
        res.render('generate-reports', { user });
    } catch (error) {
        console.error('Unexpected error:', error);
    }
});

function getNextDeliveryIds(count, callback) {
    const gapQuery = `
        WITH RECURSIVE sequence AS (
            SELECT 1 AS nextId
            UNION ALL
            SELECT nextId + 1 FROM sequence WHERE nextId < (SELECT COALESCE(MAX(deliveryId) + ${count}, ${count}) FROM deliveries)
        )
        SELECT nextId
        FROM sequence
        LEFT JOIN deliveries ON sequence.nextId = deliveries.deliveryId
        WHERE deliveries.deliveryId IS NULL
        LIMIT ?;
    `;

    connection.query(gapQuery, [count], (error, results) => {
        if (error) {
            console.error('Error fetching deliveryIds:', error);
            callback(error, null);
            return;
        }

        const ids = results.map(row => row.nextId);
        callback(null, ids);
    });
}

function getItemIdByName(itemName) {
    const item = plu.find(p => p.itemName === itemName);
    return item ? item.itemId : null;
}

function insertDeliveryItems(delivery) {
    const sql = `
        INSERT INTO deliveries (
            deliveryId,
            invoiceNum, 
            invoicePage,
            date, 
            itemId, 
            itemName, 
            cost, 
            quantity, 
            expiry,
            itemSubtotal, 
            deliveryTotal, 
            encodeDate, 
            encodePerson
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const updateInventorySql = `
        UPDATE inventory
        SET quantity = quantity + ?
        WHERE itemId = ?;
    `;

    const today = new Date();
    const encodeDate = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;

    const itemCount = delivery.items.length;

    getNextDeliveryIds(itemCount, (error, ids) => {
        if (error) {
            console.error('Error getting next deliveryIds:', error);
            return;
        }

        if (ids.length < itemCount) {
            console.error('Insufficient delivery IDs generated for items.');
            return;
        }

        delivery.items.forEach((item, index) => {
            const itemId = getItemIdByName(item.name);

            const values = [
                ids[index],                    // deliveryId - unique for each item
                lastDeliverySi,                // invoiceNum
                lastPageNum,                   // invoicePage (new field in table)
                lastDate,                      // date
                itemId,                        // itemId from PLU lookup
                item.name,                     // itemName
                parseFloat(item.cost),         // cost
                parseInt(item.quantity, 10),   // quantity
                item.expiry || 'No Expiry',    // expiry
                parseFloat(item.amount),       // itemSubtotal
                parseFloat(delivery['sale-total']), // deliveryTotal
                encodeDate,                    // encodeDate
                user                           // encodePerson
            ];

            console.log("deliveryId:", ids[index], "itemId:", itemId);

            connection.query(sql, values, (error, results) => {
                if (error) {
                    console.error('Error inserting delivery data:', error);
                } else {
                    console.log('Delivery data inserted successfully for item:', item.name, results);

                    const quantity = parseInt(item.quantity, 10);
                    connection.query(updateInventorySql, [quantity, itemId], (updateError, updateResults) => {
                        if (updateError) {
                            console.error('Error updating inventory for item:', item.name, updateError);
                        } else {
                            console.log(`Inventory updated successfully for item: ${item.name}`);
                        }
                    });
                }
            });
        });
    });
}

app.post('/save-delivery', async function(req, res) {
    if (!user) return res.redirect('/');

    try {
        console.log('Delivery Data:', req.body);
        const remarks = req.body.remarks.trim();
        const remarksFormat = /^SI\w+\s(0[1-9]|1[0-2])\/([0-2][0-9]|3[0-1])\/(\d{2}|\d{4})\s\d+\/\d+$/;

        if (remarksFormat.test(remarks)) {
            const parts = remarks.split(" ");
            lastDeliverySi = parts[0];
            lastDate = parts[1];
            lastPageNum = parts[2];

            const dateParts = lastDate.split('/');
            if (dateParts[2].length === 2) {
                dateParts[2] = '20' + dateParts[2];
            }
            lastDate = dateParts.join('/');

            console.log("Last SI:", lastDeliverySi);
            console.log("Date:", lastDate);
            console.log("Last Page Number:", lastPageNum);

            insertDeliveryItems(req.body);
            deliverySaved = 1;
        } else {
            lastDeliverySi = '';
            lastDate = '';
            lastPageNum = '';
            console.log("Remarks format is invalid.");
            deliverySaved = 0;
        }

        res.redirect('/encode-deliveries');
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('Unexpected error occurred');
    }
});

app.get('/encode-deliveries', async function(req, res) {
    if (!user) return res.redirect('/');
    try {
        let remarksString = '';
        if (lastPageNum && lastPageNum.includes('/')) {
            const [currentPage, maxPage] = lastPageNum.split('/').map(Number);

            if (currentPage < maxPage) {
                lastPageNum = `${currentPage + 1}/${maxPage}`;
                remarksString = `${lastDeliverySi} ${lastDate} ${lastPageNum}`;
            } else {
                remarksString = '';
            }
        } else {
            remarksString = '';
        }

        res.render('encode-deliveries', { user, plu, remarksString, deliverySaved });
        deliverySaved = 0;
    } catch (error) {
        res.redirect('/');
        console.error('Unexpected error:', error);
    }
});

function getNextSaleIds(count, callback) {
    const gapQuery = `
        WITH RECURSIVE sequence AS (
            SELECT 1 AS nextId
            UNION ALL
            SELECT nextId + 1 FROM sequence WHERE nextId < (SELECT COALESCE(MAX(saleId) + ${count}, ${count}) FROM sales)
        )
        SELECT nextId
        FROM sequence
        LEFT JOIN sales ON sequence.nextId = sales.saleId
        WHERE sales.saleId IS NULL
        LIMIT ?;
    `;

    connection.query(gapQuery, [count], (error, results) => {
        if (error) {
            console.error('Error fetching saleIds:', error);
            callback(error, null);
            return;
        }

        const ids = results.map(row => row.nextId);
        callback(null, ids);
    });
}

function incrementLastSaleSi(saleId) {
    const numericPart = parseInt(saleId, 10); 
    const incremented = numericPart + 1; 
    const padded = incremented.toString().padStart(saleId.length, '0'); 
    return padded;
}

function insertSaleItems(saleData) {
    const insertSql = `
        INSERT INTO sales (
            saleId,
            invoiceNum,
            date, 
            itemId, 
            itemName, 
            price, 
            quantity, 
            discountPercent, 
            isDiscounted, 
            discountRemarks, 
            itemSubtotal, 
            saleTotal, 
            encodePerson
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const updateTotalSql = `
        UPDATE sales
        SET saleTotal = ?
        WHERE invoiceNum = ?
    `;

    const updateInventorySql = `
        UPDATE inventory
        SET quantity = quantity - ?
        WHERE itemId = ? AND quantity >= ?;
    `;

    const today = new Date();
    const encodeDate = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;

    const itemCount = saleData.items.length;
    const discountRate = parseInt(saleData.discount, 10) || 0;

    // Check if invoiceNum already exists and update saleTotal if needed
    connection.query(`SELECT saleTotal FROM sales WHERE invoiceNum = ?`, [lastSaleSi], (error, results) => {
        if (error) {
            console.error('Error checking existing sale total:', error);
            return;
        }

        let existingSaleTotal = results.length > 0 ? parseFloat(results[0].saleTotal) : 0;

        const newSaleTotal = parseFloat(saleData['sale-total']);
        const updatedTotal = existingSaleTotal + newSaleTotal;

        // Update the saleTotal of the existing invoice
        connection.query(updateTotalSql, [updatedTotal, lastSaleSi], (updateError) => {
            if (updateError) {
                console.error('Error updating sale total:', updateError);
                return;
            }
            console.log(`Updated saleTotal for invoiceNum ${lastSaleSi} to ${updatedTotal}`);

            // Proceed to insert new sale items with the updated saleTotal
            getNextSaleIds(itemCount, (idError, ids) => {
                if (idError) {
                    console.error('Error getting next saleIds:', idError);
                    return;
                }

                if (ids.length < itemCount) {
                    console.error('Insufficient sale IDs generated for items.');
                    return;
                }

                saleData.items.forEach((item, index) => {
                    const itemId = getItemIdByName(item.name);

                    const values = [
                        ids[index],                            // saleId - unique for each item
                        lastSaleSi,                            // invoiceNum
                        encodeDate,                            // date
                        itemId,                                // itemId from PLU lookup
                        item.name,                             // itemName
                        parseFloat(item.price),                // price
                        parseInt(item.quantity, 10),           // quantity
                        item.discount === 'on' ? discountRate || 20 : 0, // discountPercent (use saleData.discount if discount is 'on')
                        item.discount === 'on' ? 1 : 0,        // isDiscounted
                        item.discount === 'on' ? saleData.remarks || 'Default' : 'No Discount', // discountRemarks (only if discounted)
                        parseFloat(item.amount),               // itemSubtotal
                        updatedTotal,                          // saleTotal (use the updated total)
                        user                                   // encodePerson
                    ];

                    console.log("saleId:", ids[index], "itemId:", itemId);

                    connection.query(insertSql, values, (insertError, results) => {
                        if (insertError) {
                            console.error('Error inserting sale data:', insertError);
                        } else {
                            console.log('Sale data inserted successfully for item:', item.name, results);

                            const quantity = parseInt(item.quantity, 10);
                            connection.query(updateInventorySql, [quantity, itemId, quantity], (updateInvError, updateInvResults) => {
                                if (updateInvError) {
                                    console.error('Error updating inventory for item:', item.name, updateInvError);
                                } else {
                                    if (updateInvResults.affectedRows === 0) {
                                        console.error(`Insufficient inventory for item: ${item.name}`);
                                    } else {
                                        console.log(`Inventory updated successfully for item: ${item.name}`);
                                    }
                                }
                            });
                        }
                    });
                });

                lastSaleSi = incrementLastSaleSi(lastSaleSi);
                console.log('Updated lastSaleSi:', lastSaleSi);
            });
        });
    });
}

app.post('/save-sale', async function(req, res) {
    if (!user) return res.redirect('/');

    try {
        console.log('Sale Data:', req.body);

        const saleData = req.body;
        lastSaleSi = req.body.saleId;
        
        insertSaleItems(saleData); 
        
        res.redirect('/encode-sales');
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('Unexpected error occurred');
    }
});

app.get('/encode-sales', async function(req, res) {
    if (!user) return res.redirect('/');
    try {
        const query = `
            SELECT 
                inventory.itemId,
                inventory.itemName,
                inventory.quantity,
                PLU.price,
                PLU.cost
            FROM inventory
            INNER JOIN PLU ON inventory.itemId = PLU.itemId
            WHERE inventory.quantity > 0
            ORDER BY inventory.itemName;
        `;

        connection.query(query, (err, results) => {
            if (err) {
                console.error('Error fetching data from joined PLU and inventory tables:', err);
                return;
            }
            const inventory = results;
            res.render('encode-sales', { user, inventory, lastSaleSi });
        });
    } catch (error) {
        res.redirect('/');
        console.error('Unexpected error:', error);
    }
});

app.get('/home', async function(req, res) {
    if (!user) return res.redirect('/');
    try {
        res.render('home', { user });
    } catch (error) {
        res.redirect('/');
        console.error('Unexpected error:', error);
    }
});

app.post('/verify-login', async function(req, res) {
    try {
        const password = req.body.password;

        connection.query('SELECT * FROM users WHERE password = ?', [password], (error, results) => {
            if (error) {
                console.error('Query error:', error);
                res.status(500).send('Unexpected error occurred');
                return;
            }

            if (Array.isArray(results) && results.length > 0) {
                status = true;
                user = results[0].name;
                res.redirect('/home');
            } else {
                status = false;
                res.redirect('/');
            }
        });
    } catch (error) {
        res.redirect('/');
        console.error('Unexpected error:', error);
    }
});

app.get('/', async function(req, res) {
    try {
        res.render('index', { status });
    } catch (error) {
        res.redirect('/');
        console.error('Unexpected error:', error);
    }
});

app.get('*', (req, res) => {
    if (user) {
        res.redirect('home');
    } else {
        res.redirect('/');
    }
});

var server = app.listen(3000, function() {
    console.log("App running on port 3000");
});

///////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Routing stuff
//
///////////////////////////////////////////////////////////////////////////////////////////////////////////////