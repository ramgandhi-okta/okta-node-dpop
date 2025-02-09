# Integrate node apps securely with Okta Using DPoP 

## Introduction

Integrating with Okta management API endpoints might be a very good idea if you are trying to programatically read or manage Okta resources. In this blog, I will demonstrate how to securely setup a node application to interact with Okta managment API endpoints using a service app. 

Okta API management endpoints can be accessed using an access token issued by org authorization server with appropriate scopes needed to make an API call. This can be either through authorization code flow for user as principal or client credentials flow for a service as principal. 

For this blog, we will be looking at the client crdentials flow. For this flow, Okta required `private_key_jwt` token endpoint authentication type. Access tokens generated by Okta org authorization server expires in one hour. During this one hour period, any client having access to this token will be able to call Okta API endpoints. 

**How to make it more secure?** 
Make the token sender constrained so that every call can know that the call originates from the original client which made the token call. OAuth 2.0 Demonstrating Proof of Possession (DPoP) is a way to achieve this as explained in [this rfc](https://datatracker.ietf.org/doc/html/rfc9449). 

To demonstrate this we will first setup a node application with a service app without requiring DPoP. Then we will be adding the DPoP constratint and make the necessary changes in our app to implement it.

## Setup a service app with client credentials without DPoP

**Prerequisites**

You'll need the following tools:
  * [Node.js](https://nodejs.org/en) v18 or greater
  * IDE (I used [VS Code](https://code.visualstudio.com/))
  * Terminal window (I used the integrated terminal in VS Code)
  * An Okta org 

**Setup Okta application**
* Create an `API service app` and save *Client ID*
* Change app *Client authentication* to `Public Key / Private Key`
* Add a key in *PUBLIC KEYS* section and save private key (PEM format)  as `cc_private_key.pem` and click *Save*
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
    *  `oktaService.managementApiCall(..)` method can be used to make Okta management api calls. Adds the necessary headers and tokens to enable the request
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
                    expiresIn: '5m',
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
            managementApiCall: function (relativeUri, httpMethod, headers, body) { // Construct Okta management API calls 
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

            let usersResp = await oktaService.managementApiCall('/api/v1/users', 'GET');
            if(usersResp.status == 200) {
                let respBody = await usersResp.json();
                console.log(`Users List: ${JSON.stringify(respBody)}\n`);
            } else {
                console.log('API error', usersResp);
            }
        })();
      ```
  * In `package.json` file, update `scripts` property. This gives us a easy way to run the app.
    * ```json
        "scripts": {
            "start": "node app.js"
        }
      ```
  * Run the app using `npm start`
    * You should see a list of console logs,
        * `Valid access token not found. Retrieving new token...`
        * `Using Private Key JWT: eyJh........`
        * `Making token call to https://........../oauth2/v1/token`
        * `Successfully retrieved access token: eyJ..................`
        * `Users List: [.........]`
    * If you are receiving any erros., this is a good time to troubleshoot and resolve issues before adding **DPoP**.

---

## Add DPoP to our service

**Why?**
In our setup so far, we use client_credentials grant type to authenticate and get an access token. Here if someone gets hold of the private_key_jwt, they would not be able to replay it beyond expiration (I reduced it to 5 minutes to make this window shorter). However if someone gets hold of the access token, they would be able to use it upto 1 hour which is the expiration of access tokens. 

To make it more secure, one of the ways is to make the token sender constrained. How can you do that? Just add Demonstrating Proof of Possession (DPoP). This will make sure an additional token is generated by the sender for each call it makes. This prevents any replay attacks even before tokens are expired since each call needs a fresh DPoP token. Here is the detailed flow

![Sequence diagram that displays the back and forth between the client, authorization server, and resource server for Demonstrating Proof-of-Possession](https://developer.okta.com/img/authorization/Dpopflow.png "DPoP Flow")

**Steps**
* Enable DPoP in Okta application settings. In *General Settings* section of your service app, edit *Proof of possesion* > *Require Demonstrating Proof of Possession (DPoP) header in token requests* to `true`
* We will need a new keypair to sign DPoP proof JWTs. If you know how to generate one, feel free to skip this step. I used the following steps to generate it.
    * Go to [JWK generator](https://mkjwk.org/)
    * Select the following and then click Generate.
        * Key Use: Signature
        * Algorithm: RS256
        * Key ID: SHA-256
        * Show X.509: Yes
    * Copy the Public Key (json format) and save it to `assets/dpop_public_key.json`
    * Copy the Private Key (X.509 PEM format) (**Do not click Copy to Clipboard. This will copy as single line which will not work with this following steps. Instead copy value manually and save it**) and save it to `assets/dpop_private_key.pem`
* In `.env` file, add the new file paths
    ```
    ....
    OKTA_SCOPES=okta.users.read
    OKTA_CC_PRIVATE_KEY_FILE=./assets/cc_private_key.pem
    OKTA_DPOP_PRIVATE_KEY_FILE=./assets/dpop_private_key.pem
    OKTA_DPOP_PUBLIC_KEY_FILE=./assets/dpop_public_key.json
    ```
* In `oktaService.js` include DPoP related code,
    * Add the key files to config, We can use this while adding DPoP to our methods
        ```javascript
        const oktaHelper = {
            .......
            ccPrivateKeyFile: process.env.OKTA_CC_PRIVATE_KEY_FILE || '', // Private Key for singing Private key JWT
            ccPrivateKey: null,
            // Add this ======================
            dpopPrivateKeyFile: process.env.OKTA_DPOP_PRIVATE_KEY_FILE || '', // Private key for signing DPoP proof JWT
            dpopPublicKeyFile: process.env.OKTA_DPOP_PUBLIC_KEY_FILE || '', // Public key for signing DPoP proof JWT
            dpopPrivateKey: null,
            dpopPublicKey: null,
            // Add this ======================
            accessToken: '',
            .....
        }
        ```
    
    * Add a helper method to generate DPoP value. This is used to add access token to DPoP proof JWT header. This will contruct the JWT based on format defined in [spec](https://datatracker.ietf.org/doc/html/rfc9449#section-4.2).
        ```javascript
        const oktaHelper = {
            .....
            // Add as the last attribute of oktaHelper object
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
            }
        };
        ```

    * Next add DPoP proof token to `tokenRequest` method parameters and also as token request header
        ```javascript
        // Add dpopToken as a new parameter
        tokenRequest: function(ccToken, dpopToken) { // generate token request using client_credentials grant type
            return fetch(this.getTokenEndpoint(), {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    // New Code - Start
                    DPoP: dpopToken
                    // New Code - End
                },
                ...
            });
        },
        ```

    * Add DPoP steps to `authenticate` method.
        * Generate a new DPoP proof for `POST` method and *token endpoint*
        * Make token call with both `private_key_jwt` and `DPoP` jwt
        * Okta adds addional security measure of adding a `nonce` to token request requiring DPoP. This will respond to token requests not including nonce with `use_dpop_nonce` error. Details of nonce in [spec](https://datatracker.ietf.org/doc/html/rfc9449#name-authorization-server-provid).
        * After this step, we will generate a new DPoP proof JWT including nonce value in payload
        * Make the token call again with this new JWT
        * We will get a new access token

        * Update `authenticate` method to the following
        ```javascript
        authenticate: async function() { // Use to authenticate and generate access token
            if(!oktaHelper.accessToken) { 
                console.log('Valid access token not found. Retrieving new token...\n');
                let ccToken = oktaHelper.generateCcToken();
                console.log(`Using Private Key JWT: ${ccToken}\n`);

                // New Code - Start
                let dpopToken = oktaHelper.generateDpopToken('POST', oktaHelper.getTokenEndpoint());
                console.log(`Using DPoP proof: ${dpopToken}\n`);
                // New Code - End

                console.log(`Making token call to ${oktaHelper.getTokenEndpoint()}`);

                // Update following line by adding dpopToken parameter
                let tokenResp = await oktaHelper.tokenRequest(ccToken, dpopToken);
                let respBody = await tokenResp.json();

                // New Code - Start
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
                // New Code - End

                oktaHelper.accessToken = respBody['access_token'];
                console.log(`Successfully retrieved access token: ${oktaHelper.accessToken}\n`);
            }
            return oktaHelper.accessToken;
        }
        ```

    * Make sure to enable DPoP in your Okta service application before proceeding. Now test the steps by running `npm start` in the terminal. OOPS! You would have received an access token but call to users api failed with 400 status. This is because we did not include DPoP proof. With DPoP enabled, we have to include a new DPoP proof for every call. This prevents malicious actors from reusing stolen access tokens. Let's add some code to include DPoP proof.

    * Add a helper method to generate hash of access token or `ath` value.
        ```javascript
        const oktaHelper = {
            .....,
            // Add as the last attribute of oktaHelper object
            generateAth: function(token) {
                return crypto.createHash('sha256').update(token).digest('base64').replace(/\//g, '_').replace(/\+/g, '-').replace(/\=/g, '');
            }
        };
        ```
    *  This should be added access token to DPoP proof JWT header. Add DPoP steps to `managementApiCall` method
        ```javascript
        managementApiCall: function (relativeUri, httpMethod, headers, body) { // Construct Okta management API calls 
            let uri = `${oktaHelper.oktaDomain}${relativeUri}`;

            // New Code - Start
            let ath = oktaHelper.generateAth(oktaHelper.accessToken);
            let dpopToken = oktaHelper.generateDpopToken(httpMethod, uri, {ath});
            // New Code - End

            // Update reqHeaders object
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
        ```

    * Run `npm start`
    * Voila! List of users are printed.

**Next Steps**
* Completed project can be downloaded from the github link
* Try using different Okta API scopes and experiment with different endpoints
* Make sure you give permissions to your service app by assigning appropriate Admin roles
* You can implement similar protection to your own resource server endpoints using a custom authorization server and custom set of scopes to improve security

## Learn more about Okta Management API, DPoP, and OAuth 2.0

In this post, you authenticated accessed Okta management api using a node app and were able to make it more secure by adding DPoP support. I hope you enjoyed it! If you want to learn more about the ways you can incorporate authentication and authorization security in your apps, you might want to check out these resources:

* [Okta Management API reference](https://developer.okta.com/docs/reference/)
* [OAuth 2.0 and OpenID Connect overview](https://developer.okta.com/docs/concepts/oauth-openid/)
* [Implement oAuth for Okta](https://developer.okta.com/docs/guides/implement-oauth-for-okta-serviceapp/main/)
* [Configure OAuth 2.0 Demonstrating Proof-of-Possession](https://developer.okta.com/docs/guides/dpop/-/main/)

Remember to follow us on [Twitter](https://twitter.com/oktadev) and subscribe to our [YouTube channel](https://www.youtube.com/c/OktaDev/) for more exciting content. We also want to hear from you about topics you want to see and questions you may have. Leave us a comment below!


    