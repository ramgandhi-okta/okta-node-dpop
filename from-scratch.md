# Okta Management using Node

## Introduction

In this blog, I will demonstrate how to setup a node application for interacting with Okta managment API endpoints. This can run as a service without any human intervention since it use `client_credentials` OAuth 2.0 grant type. To improve security we will be enabling Demonstration of Proof of Possession in order to make the API calls sender constrained.

==>TODO: Add a flow diagram private key jwt flow

## Setup a service app with client credentials app

**Prerequisites**

You'll need the following tools:
  * [Node.js](https://nodejs.org/en) v18 or greater
  * IDE (I used [VS Code](https://code.visualstudio.com/))
  * Terminal window (I used the integrated terminal in VS Code)
  * An Okta org 

**Setup Okta application**
* Create an `API service app` and save *Client ID*
* Change app *Client authentication* to `Public Key / Private Key`
* Add a key in *PUBLIC KEYS* section and save private key as `cc_private_key.pem` and click *Save*
* In *General Settings* section, edit *Proof of possesion* > *Require Demonstrating Proof of Possession (DPoP) header in token requests* to `false`
* Under *Okta API Scopes* tab, grant `okta.users.read` scope
* Under *Admin Roles* tab, assign `Read-only Administrator`

**Setup Okta Variables**

* Create project folder using `mkdir okta-node-dpop` and set it up as current folder
* Setup the following in `.env` file in project root directory.
```
OKTA_ORG_URL=https://{{your-okta-domain}}
OKTA_CLIENT_ID={{service-app-client-id}}
OKTA_SCOPES=okta.users.read
OKTA_CC_PRIVATE_KEY_FILE=./assets/cc_private_key.pem
```
* Save private-key file as `assets/cc_private_key.pem`

**Create Node app**
  * Run `npm init` and fill the prompts
  * Run `npm i dotenv jsonwebtoken` to install required dependencies
  * Create `oktaService.js` file in project root. We will be creating basic foundation of authenticating and calling Okta endpoints in this file. This file contains the following functions
    * `oktaService.authenticate(..)` method gets an access token by following the steps below
        * Generates a private key jwt which is need for authenticating and signs it using keypair registered in Okta pp
        * Generates token request to Okta org authorization server
        * Retrieves and stores the access token for future calls
        * This token is valid for 1 hour at the time of writing this article
    *  `oktaService.oktaManagementApiCall(..)` method can be used to make Okta management api calls. Adds the necessary headers and tokens to enable the request
    * `oktaHelper` contains utitlity methods to store okta configuration, access token, generating private key jwt, generating token request

    * ```javascript
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
      ```
  * Create `app.js` file and call the methods in `oktaService`. The following code authenticates first and then call list users endpoint.
    * ```javascript
        const oktaService = require('./oktaService.js');

        (async () => {
            await oktaService.authenticate();

            let usersResp = await oktaService.oktaManagementApiCall('/api/v1/users', 'GET');
            let respBody = await usersResp.json();
            console.log(`${JSON.stringify(respBody)}\n`);
        })();
      ```
  * In `package.json` file, update `scripts` property. This gives us a easy way to run the app.
    * ```json
        "scripts": {
            "start": "node app.js"
        }
      ```
  * Run the app using `node start`
    * You should see a list of console logs,
        * `Valid access token not found. Retrieving new token...`
        * `Using Private Key JWT: eyJh........`
        * `Making token call to https://........../oauth2/v1/token`
        * `Successfully retrieved access token: eyJ..................`
        * `Users List: [.........]`
    * If you are receiving any erros., this is a good time to troubleshoot and resolve issues before adding **DPoP**.

---

## Add DPoP to our service

...
