const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

require('dotenv').config(); // Loads varaibles in .env file into the environment

const oktaHelper = {
    oktaDomain: process.env.OKTA_ORG_URL || '', // Okta domain URL
    oktaClientId: process.env.OKTA_CLIENT_ID || '', // Client ID of API service app
    oktaScopes: process.env.OKTA_SCOPES || '', // Scopes requested - Okta managment API scopes
    ccPrivateKeyFile: process.env.OKTA_CC_PRIVATE_KEY_FILE || '', // Private Key for singing Private key JWT
    ccPrivateKey: null,
    accessToken: '',
    getTokenEndpoint: function() { return `${this.oktaDomain}/oauth2/v1/token` }, // Token endpoint
    getNewJti: function() { return crypto.randomBytes(32).toString('hex') }, // Helper method to generate new identifier
    generateCcToken: function() { // Helper method to generate private key jwt
        let privateKey = this.ccPrivateKey || fs.readFileSync(this.ccPrivateKeyFile);
        let signingOptions = {
            algorithm: 'RS256',
            expiresIn: '1h',
            audience: this.getTokenEndpoint(),
            issuer: this.oktaClientId,
            subject: this.oktaClientId
        };
        return jwt.sign({jti: this.getNewJti()}, privateKey, signingOptions);
    },
    tokenRequest: function(ccToken) { // generate token request using client_credentials grant type
        return fetch(this.getTokenEndpoint(), {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                'grant_type': 'client_credentials',
                scope: this.oktaScopes,
                'client_assertion_type': 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
                'client_assertion': ccToken
            })
        });
    }
};

const oktaService = {
    authenticate: async function() { // Use to authenticate and generate access token
        if(!oktaHelper.accessToken) { 
            console.log('Valid access token not found. Retrieving new token...\n');
            let ccToken = oktaHelper.generateCcToken();
            console.log(`Using Private Key JWT: ${ccToken}\n`);
            console.log(`Making token call to ${oktaHelper.getTokenEndpoint()}`);
            let tokenResp = await oktaHelper.tokenRequest(ccToken);
            let respBody = await tokenResp.json();
            oktaHelper.accessToken = respBody['access_token'];
            console.log(`Successfully retrieved access token: ${oktaHelper.accessToken}\n`);
        }
        return oktaHelper.accessToken;
    },
    oktaManagementApiCall: function (relativeUri, httpMethod, headers, body) { // Construct Okta management API calls 
        let uri = `${oktaHelper.oktaDomain}${relativeUri}`;
        let reqHeaders = {
            'Accept': 'application/json',
            'Authorization': `Bearer ${oktaHelper.accessToken}`,
            ...headers
        };
        return fetch(uri, {
            method: httpMethod,
            headers: reqHeaders,
            body
        });
    }
};

module.exports = oktaService;