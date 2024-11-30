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
const { stat } = require('fs');
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

var user, status, resetStatus;
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

app.get('/users', async function(req, res) {
    if (!user) return res.redirect('/');
    try {
        const query = `
            SELECT name, isAdmin FROM users;
        `;

        connection.query(query, (err, results) => {
            if (err) {
                console.error('Error fetching data from joined PLU and inventory tables:', err);
                return;
            }
            const users = results;
            res.render('users', { user, users });
        });
    } catch (error) {
        console.error('Unexpected error:', error);
    }
});

app.get('/ooq', async function(req, res) {
    if (!user) return res.redirect('/');
    try {
        const sql = `
            SELECT 
                s.itemId,
                s.itemName,
                ROUND((SUM(s.quantity) / (DATEDIFF(STR_TO_DATE(MAX(s.date), '%m/%d/%Y'), STR_TO_DATE(MIN(s.date), '%m/%d/%Y')) + 1) * 7), 2) AS AvgWeeklyDemand,
                ROUND(i.quantity / (SUM(s.quantity) / (DATEDIFF(STR_TO_DATE(MAX(s.date), '%m/%d/%Y'), STR_TO_DATE(MIN(s.date), '%m/%d/%Y')) + 1) * 7), 2) AS WOS,
                ROUND((SUM(s.quantity) / (DATEDIFF(STR_TO_DATE(MAX(s.date), '%m/%d/%Y'), STR_TO_DATE(MIN(s.date), '%m/%d/%Y')) + 1) * 7) * 0.15, 2) AS SafetyStock,
                i.quantity AS CurrentStock,
                GREATEST(
                    ROUND(
                        (SUM(s.quantity) / (DATEDIFF(STR_TO_DATE(MAX(s.date), '%m/%d/%Y'), STR_TO_DATE(MIN(s.date), '%m/%d/%Y')) + 1) * 7) + 
                        (SUM(s.quantity) / (DATEDIFF(STR_TO_DATE(MAX(s.date), '%m/%d/%Y'), STR_TO_DATE(MIN(s.date), '%m/%d/%Y')) + 1) * 7) * 0.2 - 
                        i.quantity, 0
                    ), 0
                ) AS OptimalOrderQuantity                
            FROM 
                sales s
            JOIN 
                inventory i ON s.itemId = i.itemId
            WHERE 
                STR_TO_DATE(s.date, '%m/%d/%Y') BETWEEN DATE_SUB(CURDATE(), INTERVAL 1 YEAR) AND CURDATE()
            GROUP BY 
                s.itemId, s.itemName, i.quantity
            ORDER BY 
                OptimalOrderQuantity DESC;
        `;

        connection.query(sql, (err, results) => {
            if (err) {
                console.error('Error executing Item Performance query:', error);
                return res.status(500).send('Error generating item performance report');
            }

            const columns = [
                { name: 'Item ID', class: 'string' },
                { name: 'Item Name', class: 'string' },
                { name: 'Weekly Demand', class: 'number' },
                { name: 'WOS', class: 'number' },
                { name: 'Safety Stock', class: 'int' },
                { name: 'Current Stock', class: 'int' },
                { name: 'Optimal Order Quantity', class: 'int' },
            ];

            console.log('OOQ Results:', results);

            res.render('ooq', { user, results, columns });
        });

    } catch (error) {
        res.redirect('/home');
        console.error('Unexpected error:', error);
    }
});

var editStatus, addStatus;
app.post('/add-item', async function (req, res) {
    if (!user) return res.redirect('/');

    try {
        console.log('Add Item Data:', req.body);
        const { itemId, itemName, price, cost, perishable } = req.body;

        const isPerishable = perishable ? 1 : 0;

        const today = new Date();
        const dateChange = ("0" + (today.getMonth() + 1)).slice(-2) + '/' +
                           ("0" + today.getDate()).slice(-2) + '/' +
                           today.getFullYear();

        const userChange = user.name;

        const pluQuery = `
            INSERT INTO PhIMS.PLU (
                itemId, itemName, price, cost, isPerishable, dateChange, userChange
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                price = VALUES(price), 
                cost = VALUES(cost), 
                prevPrice = price, 
                prevCost = cost, 
                dateChange = VALUES(dateChange), 
                userChange = VALUES(userChange);
        `;

        const inventoryQuery = `
            INSERT INTO PhIMS.inventory (itemId, itemName, quantity)
            VALUES (?, ?, 0)
            ON DUPLICATE KEY UPDATE 
                itemName = VALUES(itemName);
        `;

        connection.query(
            pluQuery,
            [itemId, itemName, price, cost, isPerishable, dateChange, userChange],
            (err, results) => {
                if (err) {
                    console.error('Error updating PLU table:', err);
                    addStatus = false;
                    return res.redirect('/inventory');
                }

                connection.query(
                    inventoryQuery,
                    [itemId, itemName],
                    (err, results) => {
                        if (err) {
                            console.error('Error updating inventory table:', err);
                            addStatus = false;
                            return res.redirect('/inventory');
                        }

                        addStatus = true;
                        initializePLU(); 
                        res.redirect('/inventory');
                    }
                );
            }
        );
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('Unexpected error occurred');
        addStatus = false;
        res.redirect('/inventory');
    }
});

app.post('/edit-item', async function(req, res) {
    if (!user) return res.redirect('/');

    try {
        console.log('Edit Item Data:', req.body);
        const itemId = req.body.itemId;
        const newPrice = req.body.price;
        const newCost = req.body.cost;

        const query = `
            UPDATE PLU
            SET price = ?, cost = ?, prevPrice = price, prevCost = cost, dateChange = DATE_FORMAT(CURDATE(), '%m/%d/%Y'), userChange = ?
            WHERE itemId = ?
        `;

        connection.query(query, [newPrice, newCost, user.name, itemId], (err, results) => {
            if (err) {
                console.error('Error fetching data from joined PLU and inventory tables:', err);
                editStatus = false;
                return res.redirect('/inventory');
            }
            editStatus = true;
            initializePLU();
            res.redirect('/inventory');
        });
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('Unexpected error occurred');
        editStatus = false;
        res.redirect('/inventory');
    }
});

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
            ORDER BY inventory.quantity DESC;
        `;

        connection.query(query, (err, results) => {
            if (err) {
                console.error('Error fetching data from joined PLU and inventory tables:', err);
                return;
            }
            const inventory = results;
            res.render('inventory', { user, inventory, editStatus, addStatus });
            editStatus = undefined;
            addStatus = undefined;
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
                    { name: 'Invoices', class: 'int' },
                    { name: 'Quantity Sold', class: 'int' },
                    { name: 'Gross Sales', class: 'number' },
                    { name: 'Discounts', class: 'number' },
                    { name: 'Net Sales', class: 'number' }
                ];


                res.render('reports', { user, results, aggregate, type, start, end, columns });
            });
        } else if (type === 'Profit') {
            let groupByClause, selectAdditionalField, dateFormat;

            switch (aggregate) {
                case 'Daily':
                    groupByClause = "`sales`.`date`";
                    selectAdditionalField = "`sales`.`date` AS `DateRange`";
                    dateFormat = "`sales`.`date`";
                    break;
                case 'Weekly':
                    groupByClause = "YEAR(STR_TO_DATE(`sales`.`date`, '%m/%d/%Y')), WEEK(STR_TO_DATE(`sales`.`date`, '%m/%d/%Y'))";
                    selectAdditionalField = `
                        CONCAT(
                            DATE_FORMAT(MIN(STR_TO_DATE(\`sales\`.\`date\`, '%m/%d/%Y')), '%m/%d/%Y'),
                            ' - ',
                            DATE_FORMAT(MAX(STR_TO_DATE(\`sales\`.\`date\`, '%m/%d/%Y')), '%m/%d/%Y')
                        ) AS \`DateRange\``;
                    dateFormat = "MIN(STR_TO_DATE(`sales`.`date`, '%m/%d/%Y'))";
                    break;
                case 'Monthly':
                    groupByClause = "DATE_FORMAT(STR_TO_DATE(`sales`.`date`, '%m/%d/%Y'), '%m/%Y')";
                    selectAdditionalField = `
                        DATE_FORMAT(STR_TO_DATE(\`sales\`.\`date\`, '%m/%Y')) AS \`DateRange\``;
                    dateFormat = "DATE_FORMAT(STR_TO_DATE(`sales`.`date`, '%m/%d/%Y'), '%m/%Y')";
                    break;
                case 'Yearly':
                    groupByClause = "DATE_FORMAT(STR_TO_DATE(`sales`.`date`, '%m/%d/%Y'), '%Y')";
                    selectAdditionalField = `
                        DATE_FORMAT(STR_TO_DATE(\`sales\`.\`date\`, '%Y')) AS \`DateRange\``;
                    dateFormat = "DATE_FORMAT(STR_TO_DATE(`sales`.`date`, '%m/%d/%Y'), '%Y')";
                    break;
                default:
                    return res.status(400).send('Unsupported aggregation type');
            }

            const sql = `
                SELECT 
                    ${selectAdditionalField},
                    COUNT(DISTINCT \`sales\`.\`invoiceNum\`) AS \`TotalInvoices\`,
                    SUM(\`sales\`.\`quantity\`) AS \`TotalQuantitySold\`,
                    ROUND(SUM(\`sales\`.\`quantity\` * \`PLU\`.\`cost\`), 2) AS \`TotalCost\`,
                    ROUND(SUM(DISTINCT \`sales\`.\`saleTotal\`) + SUM((\`sales\`.\`price\` * \`sales\`.\`quantity\`) * (\`sales\`.\`discountPercent\` / 100)), 2) AS \`GrossSales\`,
                    ROUND(SUM((\`sales\`.\`price\` * \`sales\`.\`quantity\`) * (\`sales\`.\`discountPercent\` / 100)), 2) AS \`TotalDiscounts\`,
                    ROUND(SUM(DISTINCT \`sales\`.\`saleTotal\`) - 
                        (SUM((\`sales\`.\`price\` * \`sales\`.\`quantity\`) * (\`sales\`.\`discountPercent\` / 100)) + SUM(\`sales\`.\`quantity\` * \`PLU\`.\`cost\`)), 2) AS \`GrossProfit\`
                FROM 
                    \`PhIMS\`.\`sales\`
                JOIN 
                    \`PhIMS\`.\`PLU\` ON \`sales\`.\`itemId\` = \`PLU\`.\`itemId\`
                WHERE 
                    STR_TO_DATE(\`sales\`.\`date\`, '%m/%d/%Y') BETWEEN STR_TO_DATE(?, '%m/%d/%Y') 
                                                                AND STR_TO_DATE(?, '%m/%d/%Y')
                GROUP BY 
                    ${groupByClause}
                ORDER BY 
                    ${dateFormat} ASC;
            `;

            connection.query(sql, [start, end], (error, results) => {
                if (error) {
                    console.error('Error executing Profit Report query:', error);
                    return res.status(500).send('Error generating profit report');
                }

                const columns = [
                    { name: 'Date Range', class: 'string' },
                    { name: 'Invoices', class: 'int' },
                    { name: 'Quantity Sold', class: 'int' },
                    { name: 'Cost', class: 'number' },
                    { name: 'Gross Sales', class: 'number' },
                    { name: 'Discounts', class: 'number' },
                    { name: 'Gross Profit', class: 'number' }
                ];

                console.log("Results: ", results);
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
                WITH

                -- Step 1: Calculate Total Sales
                TotalSales AS (
                    SELECT
                        s.itemId,
                        SUM(s.quantity) AS TotalSales
                    FROM
                        sales s
                    GROUP BY
                        s.itemId
                ),

                -- Step 2: Assign Deliveries to Age Buckets
                DeliveryAges AS (
                    SELECT
                        d.itemId,
                        d.itemName,
                        CASE
                            WHEN DATEDIFF(CURDATE(), STR_TO_DATE(d.date, '%m/%d/%Y')) <= 30 THEN 'Aged 1-30'
                            WHEN DATEDIFF(CURDATE(), STR_TO_DATE(d.date, '%m/%d/%Y')) BETWEEN 31 AND 60 THEN 'Aged 31-60'
                            WHEN DATEDIFF(CURDATE(), STR_TO_DATE(d.date, '%m/%d/%Y')) BETWEEN 61 AND 90 THEN 'Aged 61-90'
                            WHEN DATEDIFF(CURDATE(), STR_TO_DATE(d.date, '%m/%d/%Y')) > 91 THEN 'Aged > 91'
                        END AS AgeBucket,
                        SUM(d.quantity) AS BucketQuantity
                    FROM
                        deliveries d
                    GROUP BY
                        d.itemId, d.itemName, AgeBucket
                )

                -- Final Query: Pivot Age Buckets and Calculate UntrackedStock
                SELECT *
                FROM (
                    SELECT
                        i.itemId,
                        i.itemName,
                        i.quantity AS Quantity,
                        COALESCE(SUM(CASE WHEN da.AgeBucket = 'Aged 1-30' THEN da.BucketQuantity END), 0) AS Aged1to30,
                        COALESCE(SUM(CASE WHEN da.AgeBucket = 'Aged 31-60' THEN da.BucketQuantity END), 0) AS Aged31to60,
                        COALESCE(SUM(CASE WHEN da.AgeBucket = 'Aged 61-90' THEN da.BucketQuantity END), 0) AS Aged61to90,
                        COALESCE(SUM(CASE WHEN da.AgeBucket = 'Aged > 91' THEN da.BucketQuantity END), 0) AS Aged91Plus,
                        i.quantity - COALESCE(SUM(da.BucketQuantity), 0) AS Untracked
                    FROM
                        inventory i
                        LEFT JOIN DeliveryAges da ON i.itemId = da.itemId
                        LEFT JOIN TotalSales ts ON i.itemId = ts.itemId
                    GROUP BY
                        i.itemId, i.itemName, i.quantity, ts.TotalSales
                ) AS SubQuery
                WHERE
                    Aged1to30 > 0 OR Aged31to60 > 0 OR Aged61to90 > 0 OR Aged91Plus > 0;
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
                    { name: 'Avg Age', class: 'number' },
                    { name: '1-30', class: 'int' },
                    { name: '31-60', class: 'int' },
                    { name: '61-90', class: 'int' },
                    { name: '91+', class: 'int' },
                    { name: 'Untracked', class: 'int' }
                ];

                results.forEach(row => {
                    let Aged91Plus = Number(row.Aged91Plus) || 0;
                    let Aged61to90 = Number(row.Aged61to90) || 0;
                    let Aged31to60 = Number(row.Aged31to60) || 0;
                    let Aged1to30 = Number(row.Aged1to30) || 0;
                    let Untracked = Number(row.Untracked) || 0;
                
                    console.log("Initial Row Data:", row);
                    console.log("Converted Values -> Aged91Plus:", Aged91Plus, "Aged61to90:", Aged61to90, "Aged31to60:", Aged31to60, "Aged1to30:", Aged1to30, "Untracked:", Untracked);
                
                    if (Untracked < 0) {
                        let remainingUntracked = Math.abs(Untracked);
                
                        if (Aged91Plus > 0) {
                            let deplete = Math.min(Aged91Plus, remainingUntracked);
                            Aged91Plus -= deplete;
                            remainingUntracked -= deplete;
                        }
                
                        if (remainingUntracked > 0 && Aged61to90 > 0) {
                            let deplete = Math.min(Aged61to90, remainingUntracked);
                            Aged61to90 -= deplete;
                            remainingUntracked -= deplete;
                        }
                
                        if (remainingUntracked > 0 && Aged31to60 > 0) {
                            let deplete = Math.min(Aged31to60, remainingUntracked);
                            Aged31to60 -= deplete;
                            remainingUntracked -= deplete;
                        }
                
                        if (remainingUntracked > 0 && Aged1to30 > 0) {
                            let deplete = Math.min(Aged1to30, remainingUntracked);
                            Aged1to30 -= deplete;
                            remainingUntracked -= deplete;
                        }
                
                        Untracked = 0; 
                    }
                
                    const totalQuantity = Aged1to30 + Aged31to60 + Aged61to90 + Aged91Plus;
                
                    console.log("Total Quantity:", totalQuantity);
                
                    let AvgAge = 0;
                
                    if (totalQuantity > 0) {
                        const weightedSum = (Aged1to30 * 15) + (Aged31to60 * 45) + (Aged61to90 * 75) + (Aged91Plus * 105);
                        AvgAge = weightedSum / totalQuantity;
                        console.log("Weighted Sum:", weightedSum);
                    }
                
                    console.log("AvgAge Calculated:", AvgAge);
                
                    row.Aged91Plus = Aged91Plus;
                    row.Aged61to90 = Aged61to90;
                    row.Aged31to60 = Aged31to60;
                    row.Aged1to30 = Aged1to30;
                    row.Untracked = Untracked;
                    row.AvgAge = AvgAge.toFixed(2);
                });
                
                results.sort((a, b) => parseFloat(b.AvgAge) - parseFloat(a.AvgAge));

                console.log('Item Aging Results:', results);

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
                user.name                           // encodePerson
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
        const remarksFormat = /^SI\w+\s(0?[1-9]|1[0-2])\/(0?[1-9]|[1-2][0-9]|3[0-1])\/(\d{2}|\d{4})\s\d+\/\d+$/;

        if (remarksFormat.test(remarks)) {
            const parts = remarks.split(" ");
            lastDeliverySi = parts[0];
            lastDate = parts[1];
            lastPageNum = parts[2];

            const dateParts = lastDate.split('/');

            if (dateParts[0].length === 1) {
                dateParts[0] = '0' + dateParts[0];
            }
            if (dateParts[1].length === 1) {
                dateParts[1] = '0' + dateParts[1]; 
            }

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
        deliverySaved = 1;
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

    connection.query(`SELECT saleTotal FROM sales WHERE invoiceNum = ?`, [lastSaleSi], (error, results) => {
        if (error) {
            console.error('Error checking existing sale total:', error);
            return;
        }

        let existingSaleTotal = results.length > 0 ? parseFloat(results[0].saleTotal) : 0;

        const newSaleTotal = parseFloat(saleData['sale-total']);
        const updatedTotal = existingSaleTotal + newSaleTotal;

        connection.query(updateTotalSql, [updatedTotal, lastSaleSi], (updateError) => {
            if (updateError) {
                console.error('Error updating sale total:', updateError);
                return;
            }
            console.log(`Updated saleTotal for invoiceNum ${lastSaleSi} to ${updatedTotal}`);

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
                        user.name                                   // encodePerson
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
        const name = req.body.name;
        const password = req.body.password;

        connection.query('SELECT name, isAdmin FROM users WHERE LOWER(name) = LOWER(?) AND password = ?', [name, password], (error, results) => {
            if (error) {
                console.error('Query error:', error);
                res.status(500).send('Unexpected error occurred');
                return;
            }

            if (Array.isArray(results) && results.length > 0) {
                status = true;
                user = results[0];
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

app.post('/confirm-reset', async function(req, res) {
    const name = req.body.name;
    const key = req.body.key;
    const password = req.body.password;

    try {
        connection.query(
            'SELECT * FROM users WHERE LOWER(name) = LOWER(?) AND `key` = ?',
            [name, key],
            (error, results) => {
                if (error) {
                    console.error('Query error:', error);
                    res.status(500).send('Unexpected error occurred');
                    return;
                }

                if (results.length === 0) {
                    console.error('Invalid name or key');
                    resetStatus = false;
                    res.redirect('/forgot');
                }

                connection.query(
                    'UPDATE users SET password = ? WHERE LOWER(name) = LOWER(?) AND `key` = ?',
                    [password, name, key],
                    (updateError) => {
                        if (updateError) {
                            console.error('Password update error:', updateError);
                            resetStatus = false;
                            res.redirect('/forgot');
                        }

                        console.log('Password updated successfully.');
                        resetStatus = true;
                        res.redirect('/forgot'); 
                    }
                );
            }
        );
    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('Unexpected error occurred.');
    }
});

app.get('/forgot', async function(req, res) {
    try {
        res.render('forgot', { resetStatus });
        resetStatus = undefined;
    } catch (error) {
        res.redirect('/');
        console.error('Unexpected error:', error);
    }
});

app.get('/', async function(req, res) {
    try {
        user = undefined;
        res.render('index', { status });
        status = undefined;
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