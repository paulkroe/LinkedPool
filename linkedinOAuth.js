const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Environment variables
const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI = `http://localhost:${PORT}/auth/linkedin/callback`;

// In-memory storage for access tokens
let accessTokenStorage = {};

// Root route to check server status
app.get('/', (req, res) => {
    res.send('Welcome to the LinkedIn OAuth Demo');
});

// Route to start OAuth flow
app.get('/auth/linkedin', (req, res) => {
    console.log('Redirecting to LinkedIn for authorization');
    const linkedInAuthUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=openid%20profile%20email`;
    res.redirect(linkedInAuthUrl);
});


// Callback route that LinkedIn will redirect to
app.get('/auth/linkedin/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.status(400).send('Authorization code is missing');
    }

    const linkedInTokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
    const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
    }).toString();

    try {
        const tokenResponse = await axios.post(linkedInTokenUrl, params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        console.log(tokenResponse.data);
        const { access_token } = tokenResponse.data;

        // Store access token in in-memory storage
        accessTokenStorage['accessToken'] = access_token;

        res.send({
            message: 'Access token received',
        });
    } catch (error) {
        console.error('Error in LinkedIn OAuth flow:', error);
        res.status(500).send('Failed to authenticate or fetch data');
    }
});

// An example API call using the stored access token
app.get('/api/linkedin/profile', async (req, res) => {
    if (!accessTokenStorage['accessToken']) {
        return res.status(401).send('Authentication required');
    }
    const url = 'https://api.linkedin.com/v2/userinfo'; 

    axios.get(url, {
        headers: {
            Authorization: `Bearer ${accessTokenStorage['accessToken']}`
        }
    })
    .then(response => {
        res.send(response.data);
    })
    .catch(error => {
        console.error('Error fetching LinkedIn profile:', error.response.data);
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
