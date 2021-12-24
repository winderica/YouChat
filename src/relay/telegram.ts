import { inspect } from 'util';

import got from 'got';
import { Markup } from 'telegraf';

import { Relay } from '.';
import { WeChatRelay } from './wechat';
import { TelegramBot } from '../bot/telegram';
import { TELEGRAM_API_KEY, TELEGRAM_CHAT_ID } from '../config';
import { Location, Multimedia, Text } from '../type';

export class TelegramRelay extends Relay<WeChatRelay> {
  bot = new TelegramBot(TELEGRAM_API_KEY);
  peers = new Map<number, string>();
  lastPeer = '';
  lastAction?: (peer: string) => unknown;

  start() {
    this.bot
      .on('text', async (ctx) => {
        const { message: { text, reply_to_message, entities = [], chat: { id } } } = ctx;
        const commands = entities.filter((i) => i.type === 'bot_command');
        if (commands.length) {
          if (commands.length > 1) {
            ctx.reply('Multiple commands are not supported.');
          } else {
            const [{ offset, length }] = commands;
            const command = text.slice(offset, offset + length);
            const args = text.slice(offset + length).split(' ').filter(Boolean);
            switch (command) {
              default:
                ctx.reply(`Unknown command ${command}.`);
            }
          }
        } else {
          await this.send(id, reply_to_message?.message_id, (peer) => {
            this.sendTextToRelay(new Text(text, peer));
          });
        }
      })
      .on('sticker', async ({ message: { sticker: { file_id }, reply_to_message, chat: { id } } }) => {
        const file = await this.download(file_id);
        await this.send(id, reply_to_message?.message_id, (peer) => {
          this.sendStickerToRelay(new Multimedia(file, peer));
        });
      })
      .on('photo', async ({ message: { photo, reply_to_message, caption, chat: { id } } }) => {
        const { file_id } = photo.reduce((prev, curr) => prev.width * prev.height > curr.width * curr.height ? prev : curr);
        const file = await this.download(file_id);
        await this.send(id, reply_to_message?.message_id, (peer) => {
          this.sendImageToRelay(new Multimedia(file, peer));
          caption && this.sendTextToRelay(new Text(caption, peer));
        });
      })
      .on('document', async ({ message: { document: { file_id, file_name }, reply_to_message, caption, chat: { id } } }) => {
        const file = await this.download(file_id);
        await this.send(id, reply_to_message?.message_id, (peer) => {
          this.sendDocumentToRelay(new Multimedia(file, peer, file_name));
          caption && this.sendTextToRelay(new Text(caption, peer));
        });
      })
      .on('audio', async ({ message: { audio: { file_id, file_name }, reply_to_message, caption, chat: { id } } }) => {
        const file = await this.download(file_id);
        await this.send(id, reply_to_message?.message_id, (peer) => {
          this.sendDocumentToRelay(new Multimedia(file, peer, file_name));
          caption && this.sendTextToRelay(new Text(caption, peer));
        });
      })
      .on('voice', async ({ message: { voice: { file_id }, reply_to_message, caption, chat: { id } } }) => {
        const file = await this.download(file_id);
        await this.send(id, reply_to_message?.message_id, (peer) => {
          this.sendVoiceToRelay(new Multimedia(file, peer));
          caption && this.sendTextToRelay(new Text(caption, peer));
        });
      })
      .on('video', async ({ message: { video: { file_id }, reply_to_message, caption, chat: { id } } }) => {
        const file = await this.download(file_id);
        await this.send(id, reply_to_message?.message_id, (peer) => {
          this.sendVideoToRelay(new Multimedia(file, peer));
          caption && this.sendTextToRelay(new Text(caption, peer));
        });
      })
      .action(/^PEER (.*)/, (ctx) => {
        let peer = ctx.match[1];
        if (peer.startsWith('@@')) {
          peer = `@@${Buffer.from(peer.slice(2), 'base64').toString('hex')}`;
        } else if (peer.startsWith('@')) {
          peer = `@${Buffer.from(peer.slice(1), 'base64').toString('hex')}`;
        }
        this.lastPeer = peer;
        this.lastAction?.(peer);
        ctx.editMessageText('Done.', Markup.inlineKeyboard([]));
        return;
      })
      .action(/^PAGE (.*)/, (ctx) => {
        ctx.editMessageReplyMarkup(this.peerSelection(+ctx.match[1]).reply_markup);
      })
      .launch();
  }

  receiveTextFromRelay({ content, from, to, peer }: Text) {
    this.bot.telegram
      .sendMessage(TELEGRAM_CHAT_ID, `🔤 ${from} → ${to}:\n${content}`)
      .then(
        ({ message_id }) => this.addPeer(message_id, peer),
        (e) => console.error(inspect(e, { depth: null, colors: true }))
      );
  }

  receiveStickerFromRelay({ content, from, to, peer }: Multimedia) {
    this.bot.telegram.sendPhoto(TELEGRAM_CHAT_ID, {
      source: content
    }, {
      caption: `🖼️ ${from} → ${to}`
    }).then(
      ({ message_id }) => this.addPeer(message_id, peer),
      (e) => console.error(inspect(e, { depth: null, colors: true }))
    );
  }

  receiveImageFromRelay({ content, from, to, peer, filename }: Multimedia) {
    this.bot.telegram.sendPhoto(TELEGRAM_CHAT_ID, {
      source: content
    }, {
      caption: `🖼️ ${from} → ${to}${filename ? '\n' + filename : ''}`
    }).then(
      ({ message_id }) => this.addPeer(message_id, peer),
      (e) => console.error(inspect(e, { depth: null, colors: true }))
    );
  }

  receiveVideoFromRelay({ content, from, to, peer }: Multimedia) {
    this.bot.telegram.sendVideo(TELEGRAM_CHAT_ID, {
      source: content
    }, {
      caption: `📽️ ${from} → ${to}`
    }).then(
      ({ message_id }) => this.addPeer(message_id, peer),
      (e) => console.error(inspect(e, { depth: null, colors: true }))
    );
  }

  receiveDocumentFromRelay({ content, from, to, filename, peer }: Multimedia) {
    this.bot.telegram.sendDocument(TELEGRAM_CHAT_ID, {
      source: content,
      filename,
    }, {
      caption: `📃 ${from} → ${to}`
    }).then(
      ({ message_id }) => this.addPeer(message_id, peer),
      (e) => console.error(inspect(e, { depth: null, colors: true }))
    );
  }

  receiveVoiceFromRelay({ content, from, to, peer }: Multimedia) {
    this.bot.telegram.sendVoice(TELEGRAM_CHAT_ID, {
      source: content
    }, {
      caption: `🔊 ${from} → ${to}`
    }).then(
      ({ message_id }) => this.addPeer(message_id, peer),
      (e) => console.error(inspect(e, { depth: null, colors: true }))
    );
  }

  receiveLocationFromRelay({ content: [x, y], from, to, peer }: Location) {
    this.bot.telegram.sendLocation(TELEGRAM_CHAT_ID, x, y).then(
      ({ message_id }) => this.addPeer(message_id, peer),
      (e) => console.error(inspect(e, { depth: null, colors: true }))
    );
  }

  private addPeer(id: number, peer: string) {
    this.lastPeer = peer;
    this.peers.set(id, peer);
  }

  private async download(id: string) {
    const { file_path } = await this.bot.telegram.getFile(id);
    return got(`https://api.telegram.org/file/bot${TELEGRAM_API_KEY}/${file_path}`).buffer();
  }

  private async send(chatID: number, messageID: number | undefined, action: (peer: string) => unknown) {
    if (messageID && this.peers.has(messageID)) {
      this.lastPeer = this.peers.get(messageID)!;
    }
    if (this.lastPeer) {
      action(this.lastPeer);
    } else {
      this.lastAction = action;
      await this.bot.telegram.sendMessage(chatID, 'Please select a peer:', this.peerSelection(0));
    }
  }

  private peerSelection(page: number) {
    const contacts = this.receiver.getContacts();
    const from = page * 10;
    const to = (page + 1) * 10;
    return Markup.inlineKeyboard(
      [
        ...contacts.slice(from, to).map(({ RemarkName, NickName, UserName }) => {
          if (UserName.startsWith('@@')) {
            UserName = `@@${Buffer.from(UserName.slice(2), 'hex').toString('base64')}`;
          } else if (UserName.startsWith('@')) {
            UserName = `@${Buffer.from(UserName.slice(1), 'hex').toString('base64')}`;
          }
          return [Markup.button.callback(RemarkName || NickName, `PEER ${UserName}`)];
        }),
        [Markup.button.callback('<', `PAGE ${page - 1}`, from <= 0), Markup.button.callback('>', `PAGE ${page + 1}`, to >= contacts.length)],
      ]
    );
  }
}
