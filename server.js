const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const fs = require('fs');
const mongoose = require('mongoose');
const session = require('express-session');

// MongoDB Connection Setup
mongoose.connect('mongodb://localhost/database')
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err));

mongoose.connection.on('connected', () => {
    mongoose.connection.db.dropCollection('users', (err, result) => {
        if (err) {
            console.log('Error dropping collection:', err);
        } else {
            console.log('Dropped User collection successfully:', result);
        }
    });
});

// Environment variables
const PORT = process.env.PORT || 8080;
const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

// User Schema
const userSchema = new mongoose.Schema({
    linkedinId: String,
    name: String,
    email: String,
    accessToken: String,
    pictureUrl: String,
    lobbyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lobby' }  // Reference to Lobby
});

const User = mongoose.model('User', userSchema);


// Lobby Schema
const lobbySchema = new mongoose.Schema({
    lobbyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lobby' },
});

const Lobby = mongoose.model('Lobby', lobbySchema);

const linkSchema = new mongoose.Schema({
    id: { type: String, required: true },  // Custom field named 'id'
    url: { type: String, required: true },
});

const Link = mongoose.model('Link', linkSchema);

const app = express();

// Middleware for parsing JSON
app.use(express.json());

// Middleware to parse URL-encoded bodies (form submissions)
app.use(express.urlencoded({ extended: true }));

app.use(express.static('public'));


async function downloadImage(imageUrl, userId) {
    const response = await axios({
        url: imageUrl,
        method: 'GET',
        responseType: 'stream'
    });

    const filename = `${userId}.jpg`;  // Using the user's ID as the filename
    const savePath = path.join(__dirname, 'public/images', filename);
    const writer = fs.createWriteStream(savePath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(savePath));
        writer.on('error', reject);
    });
}

app.post('/create-lobby', async (req, res) => {
    try {
        const lobbyId = new mongoose.Types.ObjectId().toString(); // Generate a unique lobby ID
        const newLobby = new Lobby({ lobbyId });
        await newLobby.save();
        res.json({ lobbyId });  // Return the lobby ID as a JSON response
    } catch (error) {
        console.error('Error creating lobby:', error);
        res.status(500).send('Failed to create lobby');
    }
});

// Routes
app.get('/get-link', async (req, res) => {
    const { linkedinId, lobbyId } = req.query;

    try {
        const link = await Link.findOne({ id: linkedinId + lobbyId });
        if (link) {
            res.json({ url: link.url });
        } else {
            res.status(404).json({ message: 'Link not found' });
        }
    } catch (error) {
        console.error('Error fetching link:', error);
        res.status(500).send('Error fetching link');
    }
});

app.get('/lobby/:lobbyId', async (req, res) => {  // Marked as async
    const token = req.query.token;

    if (!token) {
        // Redirect to LinkedIn authentication with lobbyId in the query string
        const lobbyId = req.params.lobbyId;
        const linkedInAuthUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=openid%20profile%20email&state=${lobbyId}`;
        return res.redirect(linkedInAuthUrl);
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Use decoded userId to fetch user data or allow access
        const user = await User.findById(decoded.userId);  // Use await since it's an async operation
        if (!user) {
            return res.status(404).send('User not found');
        }

        // Proceed to serve the lobby
        const lobby = await Lobby.findOne({ lobbyId: req.params.lobbyId });  // Use await since it's an async operation
        if (!lobby) {
            return res.status(404).send('Lobby not found');
        }

        res.sendFile(path.join(__dirname, 'views', 'lobby.html'));

    } catch (error) {
        console.error('Invalid token:', error);
        res.status(401).send('Unauthorized: Invalid token');
    }
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'home.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'home.html'));
});

app.get('/auth/linkedin', (req, res) => {
    const linkedInAuthUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=openid%20profile%20email`;
    res.redirect(linkedInAuthUrl);
});

app.get('/auth/linkedin/callback', async (req, res) => {
    const { code, state: lobbyId } = req.query; // Get the lobbyId from the state parameter

    if (!code || !lobbyId) {
        return res.status(400).send('Authorization code or lobby ID is missing');
    }

    const tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
    const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET
    });

    try {
        // Exchange the code for an access token
        const tokenResponse = await axios.post(tokenUrl, params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const { access_token } = tokenResponse.data;
        const userProfile = await axios.get('https://api.linkedin.com/v2/userinfo', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const userName = `${userProfile.data.given_name} ${userProfile.data.family_name}`;
        const imageUrl = userProfile.data.picture;
        const linkedinId = userProfile.data.sub;
        
        let user = await User.findOneAndUpdate(
            { linkedinId: linkedinId + lobbyId},
            {
                name: userName,
                email: userProfile.data.email,
                accessToken: access_token,
                lobbyId: lobbyId
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        
        // Use the user's _id as the filename to store the image
        const userId = user._id.toString(); // Convert to string if necessary
        const picturePath = await downloadImage(imageUrl, userId);
        
        // Update the user document with the stored image path
        user.pictureUrl = `/images/${userId}.jpg`;
        await user.save();


        // Generate a JWT token
        const payload = { userId: user._id.toString(), linkedinId: user.linkedinId };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

        // Redirect to the lobby with the JWT token in the query string
        res.redirect(`/add-link?token=${token}&lobbyId=${lobbyId}`);

    } catch (error) {
        console.error('Error in LinkedIn OAuth flow:', error);
        res.status(500).send('Failed to authenticate or fetch data');
    }
});

app.get('/add-link', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'add-link.html'));
});

const authenticateToken = (req, res, next) => {
    const token = req.body.token || req.query.token || req.headers['authorization']?.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;  // Attach user info to request
        next();
    });
};

app.post('/submit-link', authenticateToken, async (req, res) => {
    const { url, lobbyId } = req.body;
    if (!url) {
        return res.status(400).send('URL is required');
    }

    try {
        // Save the link associated with the user
        const newLink = new Link({
            id: req.user.linkedinId + lobbyId,  // Associate the link with the logged-in user
            url,
        });
        await newLink.save();

        // Redirect the user to the lobby after saving the link
        res.redirect(`/lobby/${lobbyId}?token=${req.body.token}`);
    } catch (error) {
        console.error('Error saving link:', error);
        res.status(500).send('Failed to save link');
    }
});

app.get('/lobby-members/:lobbyId', async (req, res) => {
    try {
        // Fetch users where lobbyId matches the provided lobbyId
        const members = await User.find({ lobbyId: req.params.lobbyId });
        
        if (members.length === 0) {
            return res.status(404).json({ message: 'No members found in this lobby' });
        }

        res.json({ members });
    } catch (error) {
        res.status(500).send('Failed to load lobby members');
    }
});

app.get('/debug-links', async (req, res) => {
    try {
        const links = await Link.find(); // Fetch all links from the database
        res.send(`
            <html>
            <head>
                <title>Debug Links</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background-color: #f0f0f0;
                        margin: 0;
                        padding: 20px;
                    }
                    h1 {
                        color: #333;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 20px;
                    }
                    th, td {
                        padding: 10px;
                        text-align: left;
                        border-bottom: 1px solid #ddd;
                    }
                    tr:hover {
                        background-color: #f5f5f5;
                    }
                </style>
            </head>
            <body>
                <h1>All Links in Database</h1>
                <table>
                    <tr>
                        <th>User ID</th>
                        <th>URL</th>
                    </tr>
                    ${links.map(link => `
                    <tr>
                        <td>${link.id}</td>
                        <td><a href="${link.url}" target="_blank">${link.url}</a></td>
                    </tr>`).join('')}
                </table>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error fetching links:', error);
        res.status(500).send('Error fetching links from the database');
    }
});

app.get('/debug-users', async (req, res) => {
    try {
        const users = await User.find(); // Fetch all users from the database
        res.send(`
            <html>
            <head>
                <title>Debug Users</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background-color: #f0f0f0;
                        margin: 0;
                        padding: 20px;
                    }
                    h1 {
                        color: #333;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 20px;
                    }
                    th, td {
                        padding: 10px;
                        text-align: left;
                        border-bottom: 1px solid #ddd;
                    }
                    tr:hover {
                        background-color: #f5f5f5;
                    }
                </style>
            </head>
            <body>
                <h1>All Users in Database</h1>
                <table>
                    <tr>
                        <th>User ID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>LinkedIn ID</th>
                        <th>Lobby ID</th>
                    </tr>
                    ${users.map(user => `
                    <tr>
                        <td>${user._id}</td>
                        <td>${user.name}</td>
                        <td>${user.email}</td>
                        <td>${user.linkedinId}</td>
                        <td>${user.lobbyId}</td>
                    </tr>`).join('')}
                </table>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).send('Error fetching users from the database');
    }
});

app.get('/debug-lobbies', async (req, res) => {
    try {
        const lobbies = await Lobby.find(); // Fetch all lobbies from the database
        res.send(`
            <html>
            <head>
                <title>Debug Lobbies</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background-color: #f0f0f0;
                        margin: 0;
                        padding: 20px;
                    }
                    h1 {
                        color: #333;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 20px;
                    }
                    th, td {
                        padding: 10px;
                        text-align: left;
                        border-bottom: 1px solid #ddd;
                    }
                    tr:hover {
                        background-color: #f5f5f5;
                    }
                </style>
            </head>
            <body>
                <h1>All Lobbies in Database</h1>
                <table>
                    <tr>
                        <th>Lobby ID</th>
                    </tr>
                    ${lobbies.map(lobby => `
                    <tr>
                        <td>${lobby.lobbyId}</td>
                    </tr>`).join('')}
                </table>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error fetching lobbies:', error);
        res.status(500).send('Error fetching lobbies from the database');
    }
});

app.use('/images', express.static('public/images'));

async function cleanUp() {
    try {
        // Delete all users in the database
        await User.deleteMany({});
        console.log('All users deleted from database.');

        // Delete all lobbies in the database
        await Lobby.deleteMany({});
        console.log('All lobbies deleted from database.');

        // Delete all links in the database
        await Link.deleteMany({});
        console.log('All links deleted from database.');

        // Delete all images in the images folder
        const directory = path.join(__dirname, 'public/images');
        const files = await fs.promises.readdir(directory);
        
        const deletePromises = files.map(file => {
            return fs.promises.unlink(path.join(directory, file));
        });

        await Promise.all(deletePromises);
        console.log('All images deleted from images folder.');
    } catch (err) {
        console.error('Error during cleanup:', err);
    }
}

// Graceful shutdown
function handleShutdown() {
    cleanUp().then(() => {
        console.log('Cleanup complete. Shutting down server.');
        process.exit(0);
    });
}

// Handle different shutdown signals
process.on('SIGTERM', handleShutdown);  // For graceful shutdown
process.on('SIGINT', handleShutdown);   // For Ctrl+C in the terminal
process.on('exit', handleShutdown);     // When the process exits

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});