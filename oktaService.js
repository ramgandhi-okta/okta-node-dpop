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
    dpopPrivateKeyFile: process.env.OKTA_DPOP_PRIVATE_KEY_FILE || '', // Private key for signing DPoP proof JWT
    dpopPublicKeyFile: process.env.OKTA_DPOP_PUBLIC_KEY_FILE || '', // Public key for signing DPoP proof JWT
    dpopPrivateKey: null,
    dpopPublicKey: null,
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
    tokenRequest: function(ccToken, dpopToken) { // generate token request using client_credentials grant type
        return fetch(this.getTokenEndpoint(), {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                DPoP: dpopToken
            },
            body: new URLSearchParams({
                'grant_type': 'client_credentials',
                scope: this.oktaScopes,
                'client_assertion_type': 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
                'client_assertion': ccToken
            })
        });
    },
    generateDpopToken: function(htm, htu, additionalClaims) {
        let privateKey = this.dpopPrivateKey || fs.readFileSync(this.dpopPrivateKeyFile);
        let publicKey = this.dpopPublicKey || fs.readFileSync(this.dpopPublicKeyFile)
        let signingOptions = {
            algorithm: 'RS256',
            expiresIn: '5m',
            header: {
                typ: 'dpop+jwt',
                alg: 'RS256',
                jwk: JSON.parse(publicKey)
            }
        };
        let payload = {
            ...additionalClaims,
            htu,
            htm,
            jti: this.getNewJti()
        };
        return jwt.sign(payload, privateKey, signingOptions);
    },
    generateAth: function(token) {
        return crypto.createHash('sha256').update(token).digest('base64').replace(/\//g, '_').replace(/\+/g, '-').replace(/\=/g, '');
    }
};

const oktaService = {
    authenticate: async function() { // Use to authenticate and generate access token
        if(!oktaHelper.accessToken) { 
            console.log('Valid access token not found. Retrieving new token...\n');
            let ccToken = oktaHelper.generateCcToken();
            console.log(`Using Private Key JWT: ${ccToken}\n`);
            let dpopToken = oktaHelper.generateDpopToken('POST', oktaHelper.getTokenEndpoint());
            console.log(`Using DPoP proof: ${dpopToken}\n`);
            console.log(`Making token call to ${oktaHelper.getTokenEndpoint()}`);
            let tokenResp = await oktaHelper.tokenRequest(ccToken, dpopToken);
            let respBody = await tokenResp.json();
            if(tokenResp.status != 400 || (respBody && respBody.error != 'use_dpop_nonce')) {
                console.log('Authentication Failed');
                console.log(respBody);
                return null;
            }
            let dpopNonce = tokenResp.headers.get('dpop-nonce');
            console.log(`Token call failed with nonce error \n`);
            dpopToken = oktaHelper.generateDpopToken('POST', oktaHelper.getTokenEndpoint(), {nonce: dpopNonce});
            ccToken = oktaHelper.generateCcToken();
            console.log(`Retrying token call to ${oktaHelper.getTokenEndpoint()} with DPoP nonce ${dpopNonce}`);
            tokenResp = await oktaHelper.tokenRequest(ccToken, dpopToken);
            respBody = await tokenResp.json();
            oktaHelper.accessToken = respBody['access_token'];
            console.log(`Successfully retrieved access token: ${oktaHelper.accessToken}\n`);
        }
        return oktaHelper.accessToken;
    },
    managementApiCall: function (relativeUri, httpMethod, headers, body) { // Construct Okta management API calls 
        let uri = `${oktaHelper.oktaDomain}${relativeUri}`;
        let ath = oktaHelper.generateAth(oktaHelper.accessToken);
        let dpopToken = oktaHelper.generateDpopToken(httpMethod, uri, {ath});
        let reqHeaders = {
            'Accept': 'application/json',
            'Authorization': `DPoP ${oktaHelper.accessToken}`,
            'DPoP': dpopToken,
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