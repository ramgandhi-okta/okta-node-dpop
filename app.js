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