const Module = require('../module-class');

module.exports = class custom extends Module {
    get config() {
        return {
            name: 'Custom',
            description: 'Snoppsys custom module',
            debug: true // This makes it unusable to anyone besides process.env.OWNER
        };
    }
    getDbs() {
        return this.dbs;
    }
    setDbs(dbs) {
        this.dbs = dbs;
    }

};
