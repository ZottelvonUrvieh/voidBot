const fs = require('fs');
const path = require('path');
const _ = require('lodash');

class CommandHandler {
    constructor(bot) {
        this.bot = bot;
        this.commands = [];
    }

    init() {
        this.TAG_REGEX = new RegExp(`^<@!?${this.bot.user.id}> `);
    }

    async onMessage(message) {
        const processedCommand = this.processCommandAttempt(message);
        if (processedCommand.type === 'invalid') { return; }

        const command = this.getCommand(processedCommand.base);
        if (!command) { return; }

        if (command.config.location === 'NONE') { return; }

        if (command.config.location === 'DM_ONLY' &&
            !(message.channel.type === 'dm')) { return; }

        if (command.config.location === 'GUILD_ONLY' &&
            !(message.channel.type === 'text')) { return; }

        if (command.config.debug || command.mod.config.debug) {
            if (!this.bot.config.isOwner(message.author)) { return; }
        }

        if (message.channel.type === 'text') {
            if (!this.hasCommandPermissions(message.member, command)) { return; }
        }

        command.run(message, processedCommand.args).catch(error => {
            message.channel.send(`**:interrobang:  |  An error has occured:** ${error}`);
            this.bot.error(`Command error in ${command.id}: ${error}`);
        });
    }

    processCommandAttempt(message) {
        const cmdDetails = {
            type: 'invalid',
            base: '',
            args: []
        };

        const split = message.content.trim().split(' ');

        if (message.channel.type === 'dm') {
            cmdDetails.type = 'dm';
            cmdDetails.base = split[0];
            cmdDetails.args = split.slice(1);
            return cmdDetails;
        }

        if (this.TAG_REGEX.test(message.content)) {
            cmdDetails.type = 'tag';
            cmdDetails.base = split[1];
            cmdDetails.args = split.slice(2);
            return cmdDetails;
        }

        if (message.content.startsWith(this.bot.config.prefix)) {
            const prefixLength = this.bot.config.prefix.length;
            const newSplit = message.content.substr(prefixLength).trim().split(' ');

            cmdDetails.type = 'prefix';
            cmdDetails.base = newSplit[0];
            cmdDetails.args = newSplit.slice(1);
            return cmdDetails;
        }

        return cmdDetails;
    }

    getCommand(cmdText) {
        return this.commands.find((cmd) => {
            if (cmd.config.cmd === cmdText) { return true; }
            if (cmd.config.alias.includes(cmdText)) { return true; }
        });
    }

    getCommandByID(cmdId) {
        return this.commands.find(c => c.id === cmdId);
    }

    validateCommand(command) {
        if (typeof command !== 'object') { return 'Exports are empty'; }
        if (typeof command.run !== 'function') { return 'Missing run function'; }
        if (typeof command.config !== 'object') { return 'Missing config object'; }
        if (typeof command.config.name !== 'string') { return 'Config object missing "name"'; }
        if (typeof command.config.cmd !== 'string') { return 'Config object missing "cmd"'; }
        if (typeof command.config.description !== 'string') { return 'Config object missing "description"'; }

        if (typeof command.config.location !== 'string') {
            this.bot.error(`Validation Error: \'${command.id}\' missing location. Using \'NONE\'`);
            command.config.location = 'NONE';
        } else {
            let location = command.config.location;
            if (!['ALL', 'GUILD_ONLY', 'DM_ONLY', 'NONE'].includes(location)) {
                this.bot.error(`Validation Error: \'${command.id}\' invalid location. Using \'NONE\'`);
                command.config.location = 'NONE';
            }
        }

        if (!(command.config.alias instanceof Array)) {
            command.config.alias = [];
        }

        if (!(command.config.permissions instanceof Array)) {
            command.config.alias = [];
        }

        if (this.getCommand(command.config.cmd)) {
            return 'duplicate command';
        }

        if (command.config.alias.some(alias => this.getCommand(alias))) {
            return 'duplicate alias';
        }

    }

    registerCommand(command) {
        if (this.commands.includes(command)) {
            throw `Cannot register '${command.id}', already registered.`;
        }

        command.config.permissions.forEach(permission => {
            this.bot.config.registerPermission(permission);
        });

        this.commands.push(command);
    }

    unregisterCommand(command) {
        if (!this.commands.includes(command)) {
            throw `Cannot unregister '${command.id}', not registered.`;
        }

        _.pull(this.commands, command);
    }

    hasCommandPermissions(member, command) {
        // TODO: Allow per-guild permission settings.
        return member.hasPermission(command.config.permissions);
    }

    loadCommand(cmdText) {
        const split = cmdText.split('.');

        if (split.length !== 2) {
            throw `Load command ${cmdText} failed: not exactly one period.`;
        }

        const modId = split[0];
        const cmdId = split[1];

        const mod = this.bot.moduleHandler.getModule(modId);

        if (!mod) {
            throw `No module ${modId} found.`;
        }

        this.loadCommandFile(mod, `${cmdId}.js`);
    }

    // Load an individual command from file for provided mod
    loadCommandFile(mod, file, skipCheck = false) {
        const fileLoc = path.resolve(mod.moduleFolder, file);

        try {
            if (!skipCheck && !fs.statSync(fileLoc).isFile()) {
                throw `${fileLoc} is not a file`;
            }
        } catch (error) {
            throw `No file './src/modules/${mod.id}/${file}' found`;
        }


        if (path.parse(file).ext !== '.js') {
            throw `Provided file '${file}' is not a js file`;
        }

        const command = require(fileLoc.slice(0, -3));
        const cmdName = path.parse(file).name;
        const cmdId = `${mod.id}.${cmdName}`;

        // Load in the ID and mod reference
        command.id = cmdId;
        command.mod = mod;

        const check = this.validateCommand(command);
        if (check) {
            throw `Error validating command '${cmdId}': ${check}`;
        }

        mod.commands.push(command);
        this.registerCommand(command);

        this.bot.debug(`Loaded command '${cmdId}'`);
    }

    // Loads the commands for provided module
    loadModCommands(mod) {
        fs.readdirSync(mod.moduleFolder).forEach(file => {
            try {
                const fileLoc = path.resolve(mod.moduleFolder, file);

                if (!fs.statSync(fileLoc).isFile()) { return; }
                if (file === 'index.js') { return; }

                if (file.startsWith('_')) {
                    this.bot.debug(`Skipped command '${mod.id}.${path.parse(file).name}' for preceding underscore`);
                    return;
                }

                this.loadCommandFile(mod, file, true);
            } catch (error) {
                this.bot.error(`${error}`);
            }
        });
    }

}

module.exports = CommandHandler;
