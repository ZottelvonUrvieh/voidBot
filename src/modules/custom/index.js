const Module = require('../module-class');

module.exports = class custom extends Module {
    constructor(handler, id){
        super(handler, id);
        this.DBs = {};
    }
    get config() {
        return {
            name: 'Custom',
            description: 'Snoppsys custom module',
            debug: true // This makes it unusable to anyone besides process.env.OWNER
        };
    }
    get dbs() {
        
        return this.DBs;
    }
    set dbs(dbs) {
        this.DBs = dbs;
    }

};
