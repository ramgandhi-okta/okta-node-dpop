# okta-node-dpop

## Introduction

This project can be used to connect to Okta management API endpoints with a DPoP enabled service app.

## Prerequisites
* [Node.js](https://nodejs.org/en) v18 or greater
* IDE (I used [VS Code](https://code.visualstudio.com/))
* Terminal window (I used the integrated terminal in VS Code)
* An Okta org

## Setup the project

**Setup Okta application**
* Create an `API service app` and save *Client ID*
* Change app *Client authentication* to `Public Key / Private Key`
* Add a key in *PUBLIC KEYS* section and save private key in the following path in the project `assets/cc_private_key.pem` and click *Save*
* In *General Settings* section, edit *Proof of possesion* > *Require Demonstrating Proof of Possession (DPoP) header in token requests* to `true`
* Under *Okta API Scopes* tab, grant `okta.users.read` scope
* Under *Admin Roles* tab, assign `Read-only Administrator`

**Generate DPoP signing keys**
* We will need a new keypair to sign DPoP proof JWTs. If you know how to generate one, feel free to skip this step. I used the following steps to generate it.
    * Go to [JWK generator](https://mkjwk.org/)
    * Select the following and then click Generate.
        * Key Use: Signature
        * Algorithm: RS256
        * Key ID: SHA-256
        * Show X.509: Yes
    * Copy the Public Key (json format) and save it to `assets/dpop_public_key.json`
    * Copy the Private Key (X.509 PEM format) and save it to `assets/dpop_private_key.pem`

**Add necessary dependencies**
- Clone or download this github repository
- Run `npm install`
- Create `.env` file in project root directory and fill with the following,
```
OKTA_ORG_URL=https://{{your-okta-domain}}
OKTA_CLIENT_ID={{service-app-client-id}}
OKTA_SCOPES=okta.users.read
OKTA_CC_PRIVATE_KEY_FILE=./assets/cc_private_key.pem
OKTA_DPOP_PRIVATE_KEY_FILE=./assets/dpop_private_key.pem
OKTA_DPOP_PUBLIC_KEY_FILE=./assets/dpop_public_key.json
```

## Run the project
* Run the project using `npm start`

