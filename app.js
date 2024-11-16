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

// const T = require("tesseract.js");
// T.recognize('./invoiceTest2.jpg', 'eng', { logger: e => console.log(e) })
//     .then(out => console.log(out.data.text));


app.use('/stylesheets', express.static(__dirname + '/stylesheets'));
app.use('/images', express.static(__dirname + '/images'));
app.use('/images', express.static(__dirname + '/scripts'));
app.use(express.static(__dirname));

const path = require('path');

const hbs = require('hbs');
app.set('view engine','hbs');

app.use(express.json()); 
app.use(express.urlencoded({extended: true})); 
app.use(express.static('public'));

///////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// App stuff
//
///////////////////////////////////////////////////////////////////////////////////////////////////////////////

// app.get('/', async function(req, res) {
//     if (!user) return res.redirect('/');
//     try {
        
//     } catch (error) {
//         console.error('Unexpected error:', error);
//         res.status(500).send('Unexpected error occurred');
//     }
// });

var user, status;
var lastDeliverySi, lastDate, lastPageNum;
var lastSaleSi;
let plu;

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
            itemSubtotal, 
            deliveryTotal, 
            encodeDate, 
            encodePerson
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                lastDeliverySi,                        // invoiceNum
                delivery.invoicePage || null,  // invoicePage (new field in table)
                lastDate,                      // date
                itemId,                        // itemId from plu lookup
                item.name,                     // itemName
                parseFloat(item.cost),         // cost
                parseInt(item.quantity, 10),   // quantity
                parseFloat(item.amount),       // itemSubtotal
                parseFloat(delivery['sale-total']), // deliveryTotal
                encodeDate,                    // encodeDate
                user                           // encodePerson
            ];

            console.log("deliveryId:", ids[index], "itemId:", itemId);

            connection.query(sql, values, (error, results) => {
                if (error) {
                    console.error('Error inserting data:', error);
                } else {
                    console.log('Data inserted successfully for item:', item.name, results);
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
        } else {
            lastDeliverySi = '';
            lastDate = '';
            lastPageNum = '';
            console.log("Remarks format is invalid.");
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
        connection.query('SELECT * FROM PLU ORDER BY itemName', (err, results) => {
            if (err) {
                console.error('Error fetching data from PLU table:', err);
                return;
            }
            plu = results;

            let remarksString = '';
            if (lastPageNum && lastPageNum.includes('/')) {
                const [currentPage, maxPage] = lastPageNum.split('/').map(Number);

                // If the current page is less than the max page, increment current page by 1
                if (currentPage < maxPage) {
                    lastPageNum = `${currentPage + 1}/${maxPage}`;
                    remarksString = `${lastDeliverySi} ${lastDate} ${lastPageNum}`;
                } else {
                    remarksString = '';
                }

                
            } else {
                remarksString = '';
            }

        
            res.render('encode-deliveries', { user, plu, remarksString });
        });
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

function insertSaleItems(saleData) {
    const sql = `
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

    const today = new Date();
    const encodeDate = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;

    const itemCount = saleData.items.length;

    getNextSaleIds(itemCount, (error, ids) => {
        if (error) {
            console.error('Error getting next saleIds:', error);
            return;
        }

        if (ids.length < itemCount) {
            console.error('Insufficient sale IDs generated for items.');
            return;
        }

        saleData.items.forEach((item, index) => {
            const itemId = getItemIdByName(item.name);

            const values = [
                ids[index],                    // saleId - unique for each item
                lastSaleSi,                    // invoiceNum
                encodeDate,                    // date
                itemId,                        // itemId from PLU lookup
                item.name,                     // itemName
                parseFloat(item.price),        // price
                parseInt(item.quantity, 10),   // quantity
                item.discount === 'on' ? 10 : 0, // discountPercent
                item.discount === 'on' ? 1 : 0, // isDiscounted
                item.discount === 'on' ? 'Discount applied' : '', // discountRemarks
                parseFloat(item.amount),       // itemSubtotal
                parseFloat(saleData['sale-total']), // saleTotal
                user                           // encodePerson
            ];

            console.log("saleId:", ids[index], "itemId:", itemId);
            lastSaleSi+=1;

            connection.query(sql, values, (error, results) => {
                if (error) {
                    console.error('Error inserting sale data:', error);
                } else {
                    console.log('Sale data inserted successfully for item:', item.name, results);
                }
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
        connection.query('SELECT * FROM inventory WHERE quantity > 0 ORDER BY itemName', (err, results) => {
            if (err) {
                console.error('Error fetching data from PLU table:', err);
                return;
            }
            const inventory = results;
            res.render('encode-sales', { user, plu, inventory });
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