const database = require('nedb');
const fse      = require('fs-extra');
const path     = require('path');
const _        = require('lodash');
const converter = require('json-2-csv');

exports.run = async(msg, args) => {
    // msg.delete();
    // Todo: temporary:
    if (!msg.guild) return;
    // for (let blee in dbs) {
    //     console.log('msgsstats start: ' + blee + ' is ' + JSON.stringify(dbs[blee]));
    // }
    let file = path.join(__dirname, '../../../logs/' + msg.guild.name + '/json/_server_stats.json');
    let stats_db = new database(({filename: file, autoload: true}));
    stats_db.ensureIndex({fieldName: 'user_id', unique: true});
    if (args.length === 0) {
        msg.delete();
        let dbs  = this.mod.dbs;
        let guild = _.get(dbs, msg.guild.id, null);
        if (guild === null) {console.log('we done goof... dbs.get(guild_id) returns null'); return;}
        if (!guild._server_stats) guild._server_stats = stats_db;
        let results = {};
        for (let chan_handle in guild) {
            chan_handle = guild[chan_handle];
            db = _.get(chan_handle, 'db', null);
            if (db === null) continue;
            let docs = await find(db, {});
            docs.map(doc => {
                if (!results[doc.author.username]) results[doc.author.username] = [];
                results[doc.author.username].push({msg: doc, channel: chan_handle.info.channel});
            });
        }
        await _.forIn(results, async (user_handle, user) => {
            if (!results.hasOwnProperty(user)) return false;
            let user_stats        = {};
            user_stats.user       = user;
            user_stats.user_id    = user_handle[0].msg.author.id;
            user_stats.msgs_count = 0;
            user_stats.cmds       = 0;
            user_stats.chars      = 0;
            user_stats.words      = 0;
            user_stats.words_clean= 0;
            user_stats.chars_clean= 0;
            user_stats.channels   = {};            
            for (let [, chani] of msg.guild.channels) {
                user_stats.channels = {};
                user_stats.channels[chani.name] =  {msgs_count: 0, chars: 0, chars_clean: 0, words: 0, words_clean: 0, cmds: 0};
            }
            let cmd_regex = /^(!|t!|\/\/|\/|\\|\(\(|&&|&|\$|--|\?|\/)/i;
            user_handle.map(message => {
                if (!message.msg) return;
                user_stats.msgs_count++;
                if (message.msg.cleanContent && Number.isInteger(message.msg.cleanContent.length) && !isNaN(message.msg.cleanContent.length)) {
                   user_stats.chars += message.msg.cleanContent.length;
                   user_stats.chars_clean += message.msg.cleanContent.length;
                   user_stats.words += message.msg.cleanContent.split(' ').length;
                   user_stats.words_clean += message.msg.cleanContent.split(' ').length;
                }
                if (message.msg.cleanContent.match(cmd_regex)) {
                    user_stats.cmds++;
                    user_stats.chars_clean -= message.msg.cleanContent.length;
                    user_stats.words_clean -= message.msg.cleanContent.split(' ').length;
                }
                if (!user_stats.channels[message.channel])
                    user_stats.channels[message.channel] = {msgs_count: 0, chars: 0, chars_clean: 0, words: 0, words_clean: 0, cmds: 0};
                user_stats.channels[message.channel].msgs_count++;
                if (!isNaN(message.msg.cleanContent.length)) {
                    user_stats.channels[message.channel].chars += message.msg.cleanContent.length;
                    user_stats.channels[message.channel].chars_clean += message.msg.cleanContent.length;
                    user_stats.channels[message.channel].words += message.msg.cleanContent.split(' ').length;
                    user_stats.channels[message.channel].words_clean += message.msg.cleanContent.split(' ').length;
                }
                if (message.msg.cleanContent.match(cmd_regex)) {
                    user_stats.channels[message.channel].cmds++;
                    user_stats.channels[message.channel].chars_clean -= message.msg.cleanContent.length;
                    user_stats.channels[message.channel].words_clean -= message.msg.cleanContent.split(' ').length;
                }
            });
            stats_db.insert(user_stats);
            stats_db.update({user_id: user_stats.user_id}, user_stats);
        });
        dbs[msg.guild.id] = guild;
        console.log('Done updating the stats based on last `log all`');
        return Promise.resolve();
    }

    let username_regex = new RegExp(args.splice(0, 1), 'ig');
    let user_stats     = await find(stats_db, {user: username_regex});
    let channel_stats     = await find(stats_db, {});
    let server_stats     = await find(stats_db, {user: username_regex});
    // console.log(JSON.stringify(user_stats[0]));
    // msg.edit('```\n' + toJSON(user_stats) + '\n```');
    let all_stats = await find(stats_db, {});
    // let json2csvCallback = function (err, csv) {
    //     if (err) throw err;
    fse.outputFile(path.join(__dirname, '../../../logs/' + msg.guild.name + '/_stats.json'), JSON.stringify(all_stats,null,4));
    // };
    //  converter.json2csv(all_stats, json2csvCallback);
    // console.log(csv);
    // console.log( '----------------------------------------------------------------------');
    // console.log(JSON.stringify(all_stats, null, 4));
    // console.log('----------------------------------------------------------------------');
    
    let channel_string = args.join(' ');
    if (channel_string === '') channel_string = msg.channel.name;
    await msg.edit(makeString(user_stats[0], channel_string));

    function makeString(stats, channel) {
        // console.log(stats);
        if (!stats || !stats.user_id) return 'Nothing found (stats might be outdated / not loaded)...';
        let ret_string = `__**Stats for ${stats.user}:**__\n`;
        ret_string += `**${stats.msgs_count} messages** sent overall!\n` +
                      `${stats.cmds} of them have been commands.\n` +
                      `That sums up to **${stats.words_clean} words** (${stats.chars_clean} chars)! (${stats.words} and ${stats.chars} with cmds)\n` +
                      `Which makes an average of **${(stats.words_clean / (stats.msgs_count-stats.cmds)).toFixed(1)} words / message** overall`+
                      ` (${(stats.words/(stats.msgs_count)).toFixed(1)} with cmds)\n`;
        let chan = _.get(stats, ['channels', channel]);
        if (chan) {
            ret_string += `-----------------------------------\n` +
                          `**${chan.msgs_count} messages** sent in **#${channel}**!\n` +
                          `${chan.cmds} of them have been commands.\n` +
                          `That sums up to **${chan.words_clean} words** (${chan.chars_clean} chars)! (${chan.words} and ${chan.chars} with cmds)\n` +
                          `Which makes an average of **${(chan.words_clean / (chan.msgs_count-chan.cmds)).toFixed(1)} words / message**` +
                          ` words in this channel (${(chan.words/chan.msgs_count).toFixed(1)} with cmds)`;
        }
        return ret_string;
    }

//TODO: make sort work here and incooperate rankings
    function find(db, query) {
        // console.log(toJSON(db));
        return new Promise(res => {
            db.find(query).exec((err, docs) => {
                res(docs);
            });
        });
    }

    function toJSON(message) { //not neccesary anymore because no cyclic references but I ceep it to copy it for other uses
        let cache = [];
        return JSON.stringify(message, function (key, value) {
            if (typeof value === 'object' && value !== null) {
                if (cache.indexOf(value) !== -1) {
                    return;
                }
                cache.push(value);
            }
            return value;
        }, 4);
    }
};

exports.config = {
    name       : 'Name of the Command',
    cmd        : 'msgstats',
    alias      : [],
    permissions: [],
    location   : 'ALL', // 'GUILD_ONLY', 'DM_ONLY', 'ALL' - where the command can be triggered
    description: 'Description of the command',
    debug      : true // This makes it unusable to anyone besides process.env.OWNER
};
