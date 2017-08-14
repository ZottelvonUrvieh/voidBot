const fse        = require('fs-extra');
const path      = require('path');
const Discord   = require('discord.js');
const database  = require('nedb');
let bot;
let dbs = {};


class log_message {
    /**
     * @description Can eighter take a Discord.Message or an previously saved log_message Object (loaded from the database)
     * @param message
     */
    constructor(message) {
        this.id     = message.id;
        this.author = {
            id      : message.author.id,
            username: message.author.username
        };
        this.channel = {};
        this.member = {};
        if (message.member && message.author.username !== message.author.nickname && message.member.nickname !== undefined && message.member.nickname !== null) {
            this.member.nickname = ` (${message.member.nickname})`;
        }
        else {
            this.member.nickname = '';
        }
        if (message.member && message.member.highestRole && message.member.highestRole.hexColor) {
            this.member.highestRole = {hexColor: message.member.highestRole.hexColor};
        }
        this.createdAt        = new Date(message.createdAt);
        this.createdTimestamp = message.createdTimestamp;
        this.cleanContent     = message.cleanContent;

        if (message.attachments.array != undefined) {
            this.attachments = message.attachments.array().map(att => {
                return {
                    filename: att.filename,
                    url     : att.url
                };
            });
        }
        else {
            this.attachments = message.attachments;
        }

        if (message.embeds.length > 0 && message.embeds[0].message != undefined) {
            this.embeds = message.embeds.map(emb => {
                let embed_return = {
                    author     : {},
                    color      : emb.color,
                    description: emb.description,
                    fields     : emb.fields,
                    footer     : '',
                    image      : emb.image,
                    thumbnail  : '',
                    title      : emb.title,
                    url        : emb.url,
                    video      : emb.video
                };
                if (emb.author != undefined) embed_return.author = {name: emb.author.name, icon: emb.author.icon_url};
                if (emb.footer != undefined) embed_return.footer = emb.footer.text;
                if (emb.thumbnail != undefined) embed_return.thumbnail = emb.thumbnail.url;
                return embed_return;
            });
        }
        else {
            this.embeds = message.embeds;
        }
    }
}

exports.run = async (msg, args) => {
    await msg.delete();
    bot = this.mod.bot;
    let channels = [];
    dbs = this.mod.dbs;
    if (args.length === 0) {
        channels = [msg.channel];
    }
    else if (args[0] === 'all') {
        for (let [, chan] of msg.guild.channels) {
            if (chan.type === 'voice' || !(chan.permissionsFor(msg.member).serialize().READ_MESSAGES)) {
                console.log(`Skipping because voic channel or no read-perms: #${chan.name}; reading-perms: ${chan.permissionsFor(msg.member).serialize.READ_MESSAGES}; channel-type: ${chan.type}`);
                continue;
            }
            // console.log('Queing #' + chan.name + ' up for logging!');
            channels.push(chan);
        }
    }
    else {
        for (let [, chan] of msg.mentions.channels) {
            if (chan.type === 'voice') {console.log('#' + chan.name + ' is a voice channel... nothing to log there. Skipping!');}
            else if (chan.type !== 'voice' && chan.permissionsFor(msg.member).serialize().READ_MESSAGES) {
                console.log('Queing #' + chan.name + ' up for logging!');
                channels.push(chan);
            }
            else {console.log('No permission for #' + chan.name);}
        }
    }

    console.log('Amount of channels to log: ' + channels.length);
    for (let chan of channels) {
        console.log('Logging channel #' + chan.name);
        let chan_handle = _getDB(_getFilesForChannel(chan).json, chan);
        let db       = chan_handle.db;
        let after_ts = 0;
        let promise  = new Promise(function (resolve) {
            db.find({}).sort({createdTimestamp: -1}).limit(1).exec(function (err, tmp_msgs) {
                if (tmp_msgs.length > 0) {
                    after_ts = tmp_msgs[0].createdTimestamp;
                }
                _loadChannel(chan, resolve, db, null, after_ts).catch(console.error);
            });
        });
        promise.then(() => {
            db.find({createdTimestamp: {$gt: after_ts}}).sort({createdTimestamp: 1}).exec((err, msgs) => {
                dbs[chan.guild.id][chan.name] = {db: db, info: {guild: chan.guild.id, channel: chan.name}};
                this.mod.dbs = dbs;
                _writeFile(_getFilesForChannel(chan).md_simple, msgs.map(m => toString(m)).join('\n'));
                _writeFile(_getFilesForChannel(chan).md, msgs.map(m => toMarkdown(m)).join(''));
            });
        }).catch(console.error);
    }

    // for (let serverid in dbs) {
    //     if (dbs.hasOwnProperty(serverid)) {
    //         for (let channelname in dbs[serverid]) {
    //             console.log('In logging: ' + serverid + ' is ' + dbs[serverid][channelname]);
    //         }
    //     }
    // }
};

function _loadChannel(channel, resolve, db, before_message_id, after_ts) {
    return _loadChannelMessages(channel, before_message_id)
        .then(msgs => {
            let log_msgs = msgs.map(msg => {return new log_message(msg);});
            if (log_msgs.length > 0) {
                log_msgs = log_msgs.filter(m => {return m.createdTimestamp > after_ts;});
                log_msgs.map(msg => db.insert(msg));
            }
            if (log_msgs.length < 100) {
                db.find({}, (err, docs) => {
                    console.log(`#${channel.name} with ${docs.length} messages`);
                    resolve(docs);
                })
            }
            else {
                console.log(`Loading messages for #${channel.name}...`);
                return _loadChannel(channel, resolve, db, msgs[msgs.length - 1].id, after_ts);
            }
        }).catch(console.error);
}

function _getFilesForChannel(chan) {
    let dataFolder = path.join(__dirname, '../../../logs/');
    if (chan.guild) dataFolder = path.join(dataFolder, `${chan.guild.name}/`);
    let json_file  = `${dataFolder}json/${chan.name}.json`;
    let md_file    = `${dataFolder}${chan.name}.md`;
    let md_file_simple    = `${dataFolder}/simple/${chan.name}_simple.md`;
    return {json: json_file, md: md_file, md_simple: md_file_simple};
}

function _loadChannelMessages(channel, before_message_id = null) {
    let opts = {limit: 100};
    if (before_message_id !== null) {
        opts.before = before_message_id;
    }
    return channel.client.rest.methods.getChannelMessages(channel, opts)
                  .then(messages => {
                      return messages.map(msg => {msg.channel = channel; return new Discord.Message(channel, msg, bot);});
                  }).catch(console.error);
}

function _getDB(file, channel) {
    let info;
    let guild_index = 'dms';
    if (channel.guild) {
        info = {guild: channel.guild.name, channel: channel.name};
        guild_index = channel.guild.id;
    }
    else info = {guild: null, channel: channel.name};
    if (!dbs[guild_index] || !dbs[guild_index][channel.name]) {
        if (!dbs[guild_index]) dbs[guild_index] = [];
        dbs[guild_index][channel.name] = {db: new database(({filename: file, autoload: true})), info:info};
        dbs[guild_index][channel.name].db.ensureIndex({ fieldName: 'createdTimestamp', unique: true });
    }
    return dbs[guild_index][channel.name];
}

function _writeFile(file, string, rewrite = false) {
    fse.ensureFileSync(file);
    if (!rewrite) {
        return fse.appendFile(file, string, err => {
            if (err) console.log(err);
        });
    }
    return fse.outputFile(file, string, err => {
        if (err) console.log(err);
    });
}

function toString(message) {
    return `${message.author.username}${message.member.nickname} at
        ${message.createdAt.getUTCHours()}:${message.createdAt.getUTCMinutes()}:${message.createdAt.getUTCSeconds()}, on
        ${message.createdAt.toDateString()}:\n${message.cleanContent}\n`;
}

function toMarkdown(message) {
    let name = `**${message.author.username}**${message.member.nickname} `;
    if (message.member != undefined && message.member.highestRole != undefined && message.member.highestRole.hexColor != undefined) {
        name = `<span style="color:${message.member.highestRole.hexColor}">${name}</span>`;
    }
    let header        = `#### ${name}` +
                        `at **${message.createdAt.getUTCHours()}:${message.createdAt.getUTCMinutes()}:${message.createdAt.getUTCSeconds()}** (UTC), ` +
                        `on **${message.createdAt.toDateString()}**:  \n`;
    let fixed_content = message.cleanContent       // shenanegans for making content's code blocks and newlines correctly displayed in md
                            .split('```')
                            .join('\n```\n')    // sadly I have not yet found a way to keep language tags for code blocks...
                            .split('\n')
                            .filter(l => {return l !== '';}) // and also ignore #'s on the beginning on lines by adding a space before...
                            .map(s => {if (s.startsWith('#')) return ' ' + s; else return s;})
                            .join('  \n');
    if (fixed_content.split('```').length % 2 === 0) {
        fixed_content += '\n```'; // closes unclosed code tags so that no input like ``` ``` ``` can screw other messages
    }

    let embeds = '';
    for (let emb of message.embeds) {
        let tmp_string = '  \n ';
        if (emb.author != undefined && emb.author != 'undefined' && emb.author != null) {
            tmp_string += `>From: ${emb.author.name} `;
        }
        if (emb.footer != undefined && emb.footer != null && emb.footer != '' && emb.footer != undefined) {
            tmp_string += '>' + emb.footer;
        }
        if (emb.title != undefined && emb.title !== '') {
            tmp_string += `  \n>${emb.title}`;
            if (emb.title === 'Youtube') {
                tmp_string += `[![Youtube link](${emb.thumbnail})](${emb.url})`;
                embeds += tmp_string;
                continue;
            }
        }
        if (emb.description != undefined && emb.description !== '') {
            tmp_string += `  \n${emb.description.split('\n').join('  \n>')}`; // markdown requires 2 spaces at the end to recognize newlines and '>' for quotes that contain empty new lines...
        }
        let media = false;
        if (emb.thumbnail != undefined && emb.thumbnail != null && emb.thumbnail !== '') {
            tmp_string += `  \n![Attachment](${emb.thumbnail})`;
            media = true;
        }
        if (emb.image != undefined && emb.image != null) {
            tmp_string += `  \n![Attachment](${emb.image.url})`;
            media = true;
        }
        if (!media && emb.url != undefined && emb.url != '') {
            tmp_string += `  \n![url](${emb.url})`;
        }
        embeds += tmp_string;
    }
    let attatchs = message.attachments.map(att => {return `  \n> ![${att.filename}](${att.url})  \n`;}).join('');

    let seperator = '\n\n---\n';
    return header + fixed_content + embeds + attatchs + seperator;
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
    });
}

exports.config = {
    name: 'Logging',
    cmd: 'log',
    alias: ['log', 'lg', 'logging'],
    permissions: [],
    location: 'ALL', // 'GUILD_ONLY', 'DM_ONLY', 'ALL' - where the command can be triggered
    description: 'log this or all mentioned channel to file',
    debug: true // This makes it unusable to anyone besides process.env.OWNER
};
