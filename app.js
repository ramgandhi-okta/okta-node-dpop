const oktaService = require('./oktaService.js');

(async () => {
    await oktaService.authenticate();

    let usersResp = await oktaService.oktaManagementApiCall('/api/v1/users', 'GET');
    let respBody = await usersResp.json();
    console.log(`Users List: ${JSON.stringify(respBody)}\n`);
})();