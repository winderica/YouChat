import { inspect } from 'util';

import { Relay } from '.';
import { TelegramRelay } from './telegram';
import { WeChatBot } from '../bot/wechat';
import { Location, Multimedia, Text } from '../type';

export class WeChatRelay extends Relay<TelegramRelay> {
  bot!: WeChatBot;

  async start() {
    this.bot = WeChatBot.init();
    process.on('SIGINT', () => {
      this.bot.stop();
      process.exit();
    });
    this.bot
      .on('loggedIn', () => console.log(`Logged in`))
      .on('text', (data: Text) => this.sendTextToRelay(data))
      .on('photo', (data: Multimedia) => this.sendImageToRelay(data))
      .on('voice', (data: Multimedia) => this.sendVoiceToRelay(data))
      .on('video', (data: Multimedia) => this.sendVideoToRelay(data))
      .on('document', (data: Multimedia) => this.sendDocumentToRelay(data))
      .on('location', (data: Location) => this.sendLocationToRelay(data))
      .launch();
  }

  getContacts() {
    return Object.values(this.bot.contacts);
  }

  receiveTextFromRelay({ content, to }: Text): void {
    this.bot.sendText(content, to).catch((e) => {
      console.log(inspect(e, { depth: null, colors: true }));
    });
  }

  receiveStickerFromRelay({ content, to }: Multimedia): void {
    this.bot.sendEmoji(content, to).catch((e) => {
      console.log(inspect(e, { depth: null, colors: true }));
    });
  }

  receiveImageFromRelay({ content, to }: Multimedia): void {
    this.bot.sendImage(content, to).catch((e) => {
      console.log(inspect(e, { depth: null, colors: true }));
    });
  }

  receiveVideoFromRelay({ content, to }: Multimedia): void {
    this.bot.sendVideo(content, to).catch((e) => {
      console.log(inspect(e, { depth: null, colors: true }));
    });
  }

  receiveDocumentFromRelay({ content, to, filename }: Multimedia) {
    this.bot.sendDocument(filename ?? 'file', content, to).catch((e) => {
      console.log(inspect(e, { depth: null, colors: true }));
    });
  }

  receiveVoiceFromRelay(voice: Multimedia) {
    this.notImplementedType('voice message');
  }

  receiveLocationFromRelay(location: Location) {
    this.notImplementedType('location');
  }

  private notImplementedType(typeName: string): void {
    console.log(`Sending ${typeName} is not supported yet`);
  }
}
