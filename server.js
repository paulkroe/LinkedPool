const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();
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

// User Schema Setup
const userSchema = new mongoose.Schema({
    linkedinId: String,
    name: String,
    email: String,
    pictureUrl: String,
    accessToken: String  // Store access token if needed for further API calls
});

const User = mongoose.model('User', userSchema);

const app = express();

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

// Session middleware setup
app.use(session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: true }
}));

// Middleware for parsing JSON
app.use(express.json());
app.use(express.static('public'));

// Routes
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});


app.get('/auth/linkedin', (req, res) => {
    console.log('Redirecting to LinkedIn for authorization');
    const linkedInAuthUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=openid%20profile%20email`;
    res.redirect(linkedInAuthUrl);
});

app.get('/auth/linkedin/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.status(400).send('Authorization code is missing');
    }

    const tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
    const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.REDIRECT_URI,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET
    });

    try {
        // Exchange the code for an access token
        const tokenResponse = await axios.post(tokenUrl, params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const { access_token } = tokenResponse.data;

        // Fetch user profile from LinkedIn
        const userProfile = await axios.get('https://api.linkedin.com/v2/userinfo', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const userName = `${userProfile.data.given_name} ${userProfile.data.family_name}`;
        const imageUrl = userProfile.data.picture;
        const linkedinId = userProfile.data.sub;
        
        // Insert or update the user in the database to get the _id
        let user = await User.findOneAndUpdate(
            { linkedinId: linkedinId },
            {
                name: userName,
                email: userProfile.data.email,
                accessToken: access_token
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        
        // Use the user's _id as the filename to store the image
        const userId = user._id.toString(); // Convert to string if necessary
        const picturePath = await downloadImage(imageUrl, userId);
        
        // Update the user document with the stored image path
        user.pictureUrl = `/images/${userId}.jpg`;
        await user.save();
        
        // Set the session userId and redirect to home
        req.session.userId = user._id;
        res.redirect('/');

    } catch (error) {
        console.error('Error in LinkedIn OAuth flow:', error);
        res.status(500).send('Failed to authenticate or fetch data');
    }
});

app.get('/all-users', async (req, res) => {
    try {
        const users = await User.find({}, 'name pictureUrl'); // Fetch only the name and pictureUrl fields
        res.json(users); // Send back an array of objects with name and pictureUrl
    } catch (error) {
        console.error('Failed to fetch users:', error);
        res.status(500).send('Failed to fetch users');
    }
});

app.use('/images', express.static('public/images'));

async function cleanUp() {
    try {
        // Delete all users in the database
        await User.deleteMany({});
        console.log('All users deleted from database.');

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