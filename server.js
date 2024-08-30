const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/lobby', (req, res) => {
    res.json(lobby);
});


// Static middleware declared after specific routes
app.use(express.static('public'));

let lobby = [];

app.post('/join', (req, res) => {
    const { name } = req.body;
    if (name) {
        if (!lobby.includes(name)) {
            lobby.push(name);
            res.status(200).json({ message: `Welcome to the lobby, ${name}!` });
        } else {
            res.status(409).json({ message: "User already in the lobby." });
        }
    } else {
        res.status(400).json({ message: "Name is required." });
    }
});


app.post('/leave', (req, res) => {
    const { name } = req.body;
    lobby = lobby.filter(user => user !== name);
    res.status(200).send(`Goodbye, ${name}!`);
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
