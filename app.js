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
let plu;

app.get('/generate-reports', async function(req, res) {
    if (!user) return res.redirect('/');
    try {
        res.render('generate-reports', { user });
    } catch (error) {
        console.error('Unexpected error:', error);
    }
});

app.get('/encode-sales', async function(req, res) {
    if (!user) return res.redirect('/');
    try {
        connection.query('SELECT * FROM PLU ORDER BY itemName', (err, results) => {
            if (err) {
                console.error('Error fetching data from PLU table:', err);
                return;
            }
            plu = results;
            console.log('Data fetched successfully:', plu);
            res.render('encode-sales', { user, plu });
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