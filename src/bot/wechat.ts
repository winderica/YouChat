import { createHash } from 'crypto';
import EventEmitter from 'events';
import { readFileSync, writeFileSync } from 'fs';
import { Readable } from 'stream';
import { setTimeout } from 'timers/promises';
import { URL, URLSearchParams } from 'url';

import got, { Got, OptionsOfJSONResponseBody } from 'got';
import { CookieJar } from 'tough-cookie';
import { Blob, FormData } from 'formdata-node';
import { FormDataEncoder } from 'form-data-encoder';
import { load } from 'cheerio';
import { decodeXML } from 'entities';

import { WECHAT_BOT_MAGIC_STRING, WECHAT_BOT_UA } from '../config';
import { Location, Multimedia, Text } from '../type';
import { isGroup, parseEmoji } from '../utils';

const enum MediaType {
  IMAGE = 1,
  VIDEO = 2,
  AUDIO = 3,
  ATTACHMENT = 4,
}

const enum MsgType {
  UNKNOWN = 0,
  TEXT = 1,
  IMAGE = 3,
  VOICE = 34,
  VIDEO = 43,
  MICROVIDEO = 62,
  EMOTICON = 47,
  APP = 49,
  VOIPMSG = 50, // voip msg
  VOIPNOTIFY = 52, // voip 结束消息
  VOIPINVITE = 53, // voip 邀请
  LOCATION = 48,
  STATUSNOTIFY = 51,
  SYSNOTICE = 9999,
  POSSIBLEFRIEND_MSG = 40,
  VERIFYMSG = 37,
  SHARECARD = 42,
  SYS = 10000,
  RECALLED = 10002,
}

const enum AppMsgType {
  UNKNOWN = 0,
  TEXT = 1,
  IMG = 2,
  AUDIO = 3,
  VIDEO = 4,
  URL = 5,
  ATTACH = 6,
  OPEN = 7,
  EMOJI = 8,
  VOICE_REMIND = 9,
  SCAN_GOOD = 10,
  GOOD = 13,
  EMOTION = 15,
  CARD_TICKET = 16,
  REALTIME_SHARE_LOCATION = 17,
  TRANSFERS = 2000,
  RED_ENVELOPES = 2001,
  READER_TYPE = 100001,
}

const enum StatusNotifyCode {
  READED = 1,
  ENTER_SESSION,
  INITED,
  SYNC_CONV,
  QUIT_SESSION,
}

interface BaseResponse {
  Ret: number;
  ErrMsg: string
}

interface User {
  Uin: number,
  UserName: string,
  NickName: string,
  HeadImgUrl: string,
  RemarkName: string,
  PYInitial: string,
  PYQuanPin: string,
  RemarkPYInitial: string,
  RemarkPYQuanPin: string,
  HideInputBarFlag: number,
  StarFriend: number,
  Sex: number,
  Signature: string,
  AppAccountFlag: number,
  VerifyFlag: number,
  ContactFlag: number,
  WebWxPluginSwitch: number,
  HeadImgFlag: number,
  SnsFlag: number
}

interface Contact extends User {
  MemberList: Contact[],
  OwnerUin: number,
  Statues: number,
  AttrStatus: number,
  Province: string,
  City: string,
  Alias: string,
  UniFriend: number,
  DisplayName: string,
  ChatRoomId: number,
  KeyWord: string,
  EncryChatRoomId: string,
  IsOwner: number
}

interface SyncKey {
  Count: number;
  List: { Key: string, Val: string }[];
}

interface Msg {
  MsgId: string,
  FromUserName: string,
  ToUserName: string,
  MsgType: MsgType,
  Content: string,
  Status: number,
  ImgStatus: number,
  CreateTime: number,
  VoiceLength: number,
  PlayLength: number,
  FileName: string,
  FileSize: string,
  MediaId: string,
  Url: string,
  AppMsgType: AppMsgType,
  StatusNotifyCode: StatusNotifyCode,
  StatusNotifyUserName: string,
  // RecommendInfo: {
  //     UserName: '',
  //     NickName: '',
  //     QQNum: 0,
  //     Province: '',
  //     City: '',
  //     Content: '',
  //     Signature: '',
  //     Alias: '',
  //     Scene: 0,
  //     VerifyFlag: 0,
  //     AttrStatus: 0,
  //     Sex: 0,
  //     Ticket: '',
  //     OpCode: 0
  // },
  ForwardFlag: number,
  AppInfo: { AppID: string, Type: number },
  HasProductId: number,
  Ticket: string,
  ImgHeight: number,
  ImgWidth: number,
  SubMsgType: MsgType,
  NewMsgId: number,
  OriContent: string,
  EncryFileName: string,
}

class Session {
  valid: boolean;
  skey: string;
  uin: string;
  sid: string;
  ticket: string;

  constructor({ skey = '', uin = '', sid = '', ticket = '', valid = false }) {
    this.skey = skey;
    this.uin = uin;
    this.sid = sid;
    this.ticket = ticket;
    this.valid = valid;
  }
}

export class WeChatBot extends EventEmitter {
  client: Got;
  loginClient: Got;
  pushClient: Got;
  fileClient: Got;
  state = 0;
  user!: User;
  syncKey!: SyncKey;
  contacts: Record<string, Contact> = {};

  on(eventName: 'text', listener: (message: Text) => void): this;
  on(eventName: 'video', listener: (message: Multimedia) => void): this;
  on(eventName: 'photo', listener: (message: Multimedia) => void): this;
  on(eventName: 'voice', listener: (message: Multimedia) => void): this;
  on(eventName: 'document', listener: (message: Multimedia) => void): this;
  on(eventName: 'location', listener: (message: Location) => void): this;
  on(eventName: 'launch', listener: () => void): this;
  on(eventName: 'loggedIn', listener: () => void): this;
  on(eventName: 'scanning', listener: () => void): this;
  on(eventName: 'scanned', listener: () => void): this;
  on(eventName: string | symbol, listener: (...args: any[]) => void) {
    super.on(eventName, listener);
    return this;
  }

  emit(eventName: 'text', message: Text): boolean;
  emit(eventName: 'video', message: Multimedia): boolean;
  emit(eventName: 'photo', message: Multimedia): boolean;
  emit(eventName: 'voice', message: Multimedia): boolean;
  emit(eventName: 'document', message: Multimedia): boolean;
  emit(eventName: 'location', message: Location): boolean;
  emit(eventName: 'launch'): boolean;
  emit(eventName: 'loggedIn'): boolean;
  emit(eventName: 'scanning'): boolean;
  emit(eventName: 'scanned'): boolean;
  emit(eventName: string | symbol, ...args: any[]) {
    return super.emit(eventName, ...args);
  }

  private constructor(
    private session: Session,
    private cookieJar: CookieJar
  ) {
    super();
    this.client = got.extend({
      prefixUrl: 'https://wx2.qq.com/cgi-bin/mmwebwx-bin',
      headers: {
        'user-agent': WECHAT_BOT_UA,
      },
      cookieJar,
      retry: {
        limit: 10,
        methods: [],
        statusCodes: [],
        errorCodes: [
          'ETIMEDOUT',
          'ECONNRESET',
          'EADDRINUSE',
          'ECONNREFUSED',
          'EPIPE',
          'ENOTFOUND',
          'ENETUNREACH',
          'EAI_AGAIN'
        ],
        calculateDelay: () => 10000,
      },
    });
    this.loginClient = this.client.extend({
      prefixUrl: 'https://login.wx2.qq.com',
    });
    this.pushClient = this.client.extend({
      prefixUrl: 'https://webpush.wx2.qq.com/cgi-bin/mmwebwx-bin',
    });
    this.fileClient = this.client.extend({
      prefixUrl: 'https://file.wx2.qq.com/cgi-bin/mmwebwx-bin',
    });
    this.state = 0;
    this.on('launch', () => this.login());
    this.on('loggedIn', () => this.poll());
  }

  static init() {
    try {
      const config = JSON.parse(readFileSync('./state.json', 'utf-8'));
      return new WeChatBot(new Session(config.session), CookieJar.fromJSON(config.cookie));
    } catch {
      return new WeChatBot(new Session({}), new CookieJar());
    }
  }

  async login() {
    while (this.state === 0) {
      if (!this.session.valid) {
        const uuid = await this.getUUID();
        this.emit('photo', {
          content: await this.loginClient.get(`qrcode/${uuid}`).buffer(),
          to: 'You',
          from: 'Bot',
          peer: '',
        });
        this.session = await this.newLoginPage(await this.checkLogin(uuid));
      }
      try {
        const { User, SyncKey } = await this.pageInit();
        this.user = User;
        this.contacts[User.UserName] = User as Contact;
        this.syncKey = SyncKey;
        await this.notifyMobile(this.user.UserName);
        await this.getContacts();
        this.state = 1;
        this.emit('loggedIn');
      } catch ({ message }) {
        this.emit('text', {
          content: message as string,
          to: 'You',
          from: 'Bot',
          peer: '',
        });
        this.session.valid = false;
      }
    }
  }

  async poll() {
    while (this.state === 1) {
      try {
        if (await this.syncCheck()) {
          const { AddMsgList, ModContactList, SyncKey } = await this.sync();
          this.syncKey = SyncKey;
          await Promise.all(AddMsgList.map((message) => this.processMessage(message)));
          await setTimeout(5000);
        }
      } catch ({ message }) {
        this.emit('text', {
          content: message as string,
          to: 'You',
          from: 'Bot',
          peer: '',
        });
        this.state = 0;
        this.emit('launch');
      }
    }
  }

  stop() {
    writeFileSync('./state.json', JSON.stringify({
      session: this.session,
      cookie: this.cookieJar.toJSON()
    }));
  }

  launch() {
    this.emit('launch');
  }

  async getUUID() {
    const res = await this.loginClient.get('jslogin', {
      searchParams: {
        appid: 'wx782c26e4c19acffb',
        fun: 'new',
      }
    }).text();
    const [, code, uuid] = res.match(/code\s*=\s*(\d+).*uuid\s*=\s*"(\S+)"/)!;
    if (code === '200') {
      return uuid;
    } else {
      throw new Error('failed to get uuid');
    }
  }

  async checkLogin(uuid: string) {
    while (true) {
      const res = await this.loginClient.get('cgi-bin/mmwebwx-bin/login', {
        searchParams: {
          loginicon: 'true',
          uuid,
          tip: 1,
          r: ~new Date(),
        }
      }).text();
      const code = res.match(/code\s*=\s*(\d+)/)![1];
      switch (+code) {
        case 200: // confirmed
          const redirectURL = res.match(/redirect_uri\s*=\s*"(\S+)"/)![1];
          return new URL(redirectURL).searchParams;
        case 201: // scanned
          this.emit('scanned');
          break;
        case 408: // scanning
          this.emit('scanning');
          break;
        default:
          throw new Error('failed to login');
      }
      await setTimeout(1000);
    }
  }

  async newLoginPage(params: URLSearchParams) {
    params.set('fun', 'new');
    params.set('version', 'v2');
    params.set('mod', 'desktop');
    const res = await this.client.get(`webwxnewloginpage`, {
      headers: {
        'client-version': '2.0.0',
        extspam: WECHAT_BOT_MAGIC_STRING,
        referer: 'https://wx.qq.com/?&lang=zh_CN&target=t'
      },
      searchParams: params,
    }).text();
    const ret = res.match(/<ret>(.*)<\/ret>/)?.[1];
    const message = res.match(/<message>(.*)<\/message>/)?.[1];
    const redirecturl = res.match(/<redirecturl>(.*)<\/redirecturl>/)?.[1];
    if (redirecturl) {
      throw new Error('unexpected redirect url');
    }
    if (ret !== '0') {
      throw new Error(`Failed to login: ${message}`);
    }
    return new Session({
      uin: res.match(/<wxuin>(.*)<\/wxuin>/)![1],
      sid: res.match(/<wxsid>(.*)<\/wxsid>/)![1],
      skey: res.match(/<skey>(.*)<\/skey>/)![1],
      ticket: res.match(/<pass_ticket>(.*)<\/pass_ticket>/)![1],
      valid: true,
    });
  }

  async pageInit() {
    const res = await this.client.post('webwxinit', {
      searchParams: {
        r: ~new Date(),
      },
      json: {
        BaseRequest: this.baseRequest,
      }
    }).json<{
      BaseResponse: BaseResponse,
      User: User,
      SyncKey: SyncKey,
    }>();
    if (res.BaseResponse.Ret) {
      throw new Error(`failed to init page: ${res.BaseResponse.ErrMsg}`);
    }
    return res;
  }

  async getContacts() {
    const { skey, ticket } = this.session;
    let seq = 0;
    while (true) {
      const { Seq, BaseResponse, MemberList } = await this.client.get('webwxgetcontact', {
        searchParams: {
          skey,
          pass_ticket: ticket,
          seq,
          r: Date.now()
        }
      }).json<{
        BaseResponse: BaseResponse,
        MemberList: Contact[],
        Seq: number
      }>();
      if (BaseResponse.Ret) {
        throw new Error(`failed to get contacts: ${BaseResponse.ErrMsg}`);
      }
      MemberList.forEach((member) => {
        this.contacts[member.UserName] = {
          ...member,
          NickName: parseEmoji(member.NickName),
          RemarkName: parseEmoji(member.RemarkName),
        };
      });
      if (Seq === 0) {
        break;
      }
      seq = Seq;
    }
  }

  async getGroup(groupName: string) {
    const { BaseResponse, ContactList: [group] } = await this.client.post('webwxbatchgetcontact', {
      searchParams: {
        type: 'ex',
        r: Date.now()
      },
      json: {
        BaseRequest: this.baseRequest,
        Count: 1,
        List: [{
          UserName: groupName,
          ChatRoomId: ''
        }]
      }
    }).json<{
      BaseResponse: BaseResponse,
      ContactList: Contact[],
    }>();
    if (BaseResponse.Ret) {
      throw new Error(`failed to get group: ${BaseResponse.ErrMsg}`);
    }
    this.contacts[group.UserName] = group;
  }

  async getGroupMember(groupID: string, username: string) {
    const { BaseResponse, ContactList: [member] } = await this.client.post('webwxbatchgetcontact', {
      searchParams: {
        type: 'ex',
        r: Date.now()
      },
      json: {
        BaseRequest: this.baseRequest,
        Count: 1,
        List: [{
          UserName: username,
          EncryChatRoomId: groupID,
        }]
      }
    }).json<{
      BaseResponse: BaseResponse,
      ContactList: Contact[],
    }>();
    if (BaseResponse.Ret) {
      throw new Error(`failed to get group: ${BaseResponse.ErrMsg}`);
    }
    this.contacts[member.UserName] = member;
  }

  async notifyMobile(username: string) {
    await this.client.post('webwxstatusnotify', {
      json: {
        BaseRequest: this.baseRequest,
        Code: StatusNotifyCode.INITED,
        FromUserName: username,
        ToUserName: username,
        ClientMsgId: Date.now(),
      }
    })
  }

  async syncCheck() {
    const { uin, sid, skey } = this.session;
    const res = await this.pushClient.get('synccheck', {
      searchParams: {
        r: Date.now(),
        skey,
        sid,
        uin,
        deviceid: `e${Math.random().toFixed(15).substring(2, 17)}`,
        synckey: this.syncKey.List.map(({ Key, Val }) => `${Key}_${Val}`).join('|')
      }
    }).text();
    const retcode = res.match(/retcode\s*:\s*"(\d+)"/)![1];
    const selector = res.match(/selector\s*:\s*"(\d+)"/)![1];
    if (retcode !== '0') {
      throw new Error('failed to sync');
    }
    return +selector;
  }

  get baseRequest() {
    const { uin, sid, skey } = this.session;
    return {
      Uin: uin,
      Sid: sid,
      Skey: skey,
      DeviceID: `e${Math.random().toFixed(15).substring(2, 17)}`
    }
  }

  async sync() {
    const { sid, skey } = this.session;
    const res = await this.client.post('webwxsync', {
      searchParams: {
        skey,
        sid,
      },
      json: {
        BaseRequest: this.baseRequest,
        SyncKey: this.syncKey,
        rr: ~new Date(),
      }
    }).json<{
      BaseResponse: BaseResponse,
      SyncKey: SyncKey,
      ModChatRoomMemberList: [],
      DelContactList: [],
      ModContactList: [],
      AddMsgList: Msg[],
    }>();
    if (res.BaseResponse.Ret) {
      throw new Error(`failed to sync: ${res.BaseResponse.ErrMsg}`);
    }
    return res;
  }

  async processMessage(message: Msg) {
    let content = message.Content,
      sender = message.FromUserName;
    let receiver = message.ToUserName;
    const peer = (message.FromUserName === this.user.UserName || message.FromUserName === '') ? message.ToUserName : message.FromUserName;

    if (isGroup(peer)) {
      content = content.replace(/^(@[a-zA-Z0-9]+|[a-zA-Z0-9_-]+):<br\/>/, (_, username) => {
        sender = username;
        return '';
      });
      receiver = peer;
      if (!this.contacts[peer]) {
        await this.getGroup(peer);
      }
      if (!this.contacts[sender]) {
        await this.getGroupMember(this.contacts[peer].EncryChatRoomId, sender);
      }
    }
    sender = this.contacts[sender]?.RemarkName || this.contacts[sender]?.NickName || sender;
    receiver = this.contacts[receiver]?.RemarkName || this.contacts[receiver]?.NickName || receiver;
    content = decodeXML(parseEmoji(content.replaceAll('<br/>', '\n')));

    const from = sender;
    const to = receiver;

    if (message.AppMsgType) {
      message.MsgType = MsgType.APP;
    }

    const data = {
      from,
      to,
      peer,
    };

    switch (message.MsgType) {
      case MsgType.TEXT: // 文本消息
        if (message.SubMsgType === MsgType.LOCATION) {
          const x = message.OriContent.match(/x="(.+?)"/)![1];
          const y = message.OriContent.match(/y="(.+?)"/)![1];
          this.emit('location', {
            content: [+x, +y],
            ...data,
          });
        } else {
          this.emit('text', {
            content,
            ...data,
          });
        }
        break;
      case MsgType.EMOTICON: // 表情消息
        if (message.HasProductId) {
          this.emit('text', {
            content: 'Unsupported sticker',
            ...data,
          });
          break;
        }
      case MsgType.IMAGE: // 图片消息
        this.emit('photo', {
          content: await this.client.get('webwxgetmsgimg', {
            searchParams: {
              msgid: message.MsgId,
              skey: this.session.skey,
            }
          }).buffer(),
          ...data,
        });
        break;
      case MsgType.VOICE: // 语音消息
        this.emit('voice', {
          content: await this.client.get('webwxgetvoice', {
            searchParams: {
              msgid: message.MsgId,
              skey: this.session.skey,
            }
          }).buffer(),
          ...data,
        });
        break;
      case MsgType.VIDEO: // 视频消息
      case MsgType.MICROVIDEO: // 小视频消息
        this.emit('video', {
          content: await this.client.get('webwxgetvideo', {
            searchParams: {
              msgid: message.MsgId,
              skey: this.session.skey,
            },
            headers: {
              Connection: 'keep-alive'
            },
            hooks: {
              beforeRequest: [
                ({ headers }) => {
                  headers['Range'] = 'bytes=0-';
                }
              ]
            }
          }).buffer(),
          ...data,
        });
        break;
      case MsgType.LOCATION: // 地理位置消息
        const x = message.OriContent.match(/x="(.+?)"/)![1];
        const y = message.OriContent.match(/y="(.+?)"/)![1];
        this.emit('location', {
          content: [+x, +y],
          ...data,
        });
        break;
      case MsgType.APP: // APP消息
        switch (message.AppMsgType) {
          case AppMsgType.IMG:
          case AppMsgType.EMOJI:
            this.emit('photo', {
              content: await this.client.get('webwxgetmsgimg', {
                searchParams: {
                  msgid: message.MsgId,
                  skey: this.session.skey,
                }
              }).buffer(),
              ...data,
            });
            break;
          case AppMsgType.ATTACH:
            this.emit('document', {
              content: await this.fileClient.get('webwxgetmedia', {
                searchParams: {
                  sender: message.FromUserName,
                  mediaid: message.MediaId,
                  encryfilename: message.EncryFileName,
                  fromuser: this.user.Uin,
                  pass_ticket: this.session.ticket,
                }
              }).buffer(),
              filename: message.FileName,
              ...data,
            });
            break;
          case AppMsgType.TEXT:
          case AppMsgType.AUDIO:
          case AppMsgType.VIDEO:
          case AppMsgType.URL:
          case AppMsgType.OPEN:
          case AppMsgType.VOICE_REMIND:
          case AppMsgType.SCAN_GOOD:
          case AppMsgType.GOOD:
          case AppMsgType.EMOTION:
          case AppMsgType.CARD_TICKET:
          case AppMsgType.REALTIME_SHARE_LOCATION:
          case AppMsgType.TRANSFERS:
          case AppMsgType.RED_ENVELOPES:
          case AppMsgType.READER_TYPE:
          default:
            this.emit('text', {
              content: 'Unknown message',
              ...data,
            });
            console.log(message);
            break;
        }
        break;
      case MsgType.SHARECARD: // 名片消息
        const { bigheadimgurl, nickname, username } = load(content, { xml: true })('msg').get(0).attribs;
        this.emit('photo', {
          content: await got(bigheadimgurl.replace(/^http/, 'https')).buffer(),
          filename: `User Card: ${nickname ?? username}`,
          ...data,
        });
        break;
      case MsgType.SYS: // 系统消息
        this.emit('text', {
          content,
          ...data,
        });
        break;
      case MsgType.STATUSNOTIFY:
      case MsgType.RECALLED: // 消息撤回
      case MsgType.SYSNOTICE:
        break;
      case MsgType.VOIPMSG: // VOIP消息
      case MsgType.VOIPNOTIFY:
      case MsgType.VOIPINVITE:
      case MsgType.POSSIBLEFRIEND_MSG: // 好友推荐消息
      case MsgType.VERIFYMSG: // 认证消息
      default:
        this.emit('text', {
          content: 'Unknown message',
          ...data,
        });
        console.log(message);
        break;
    }
  }

  async send(path: string, data: Record<string, unknown>, options?: OptionsOfJSONResponseBody) {
    const id = (Date.now() + Math.random().toFixed(3)).replace('.', '');
    const { BaseResponse } = await this.client.post(path, {
      json: {
        BaseRequest: this.baseRequest,
        Msg: {
          FromUserName: this.user.UserName,
          LocalID: id,
          ClientMsgId: id,
          ...data,
        },
        Scene: 0
      },
      ...options,
    }).json<{
      BaseResponse: BaseResponse,
    }>();
    if (BaseResponse.Ret) {
      throw new Error(`failed to send: ${BaseResponse.ErrMsg}`);
    }
  }

  async upload(content: Buffer, type: MsgType, to: string) {
    const size = 512 * 1024
    const chunks = Math.ceil(content.length / size);
    const body = new FormData();
    body.set('chunks', chunks.toString());
    body.set('mediatype', type === MsgType.IMAGE ? 'pic' : type === MsgType.VIDEO ? 'video' : 'doc');
    body.set('uploadmediarequest', JSON.stringify({
      UploadType: 2,
      BaseRequest: this.baseRequest,
      ClientMediaId: Date.now(),
      TotalLen: content.length,
      StartPos: 0,
      DataLen: content.length,
      MediaType: MediaType.ATTACHMENT,
      FromUserName: this.user.UserName,
      ToUserName: to,
      FileMd5: createHash('md5').update(content).digest('hex'),
    }));
    body.set('pass_ticket', this.session.ticket);
    let mediaId = '';
    for (let i = 0; i < chunks; i++) {
      body.set('chunk', i.toString());
      body.set('filename', new Blob([content.slice(i * size, (i + 1) * size)]));
      const encoder = new FormDataEncoder(body);
      const { BaseResponse, MediaId } = await this.fileClient.post('webwxuploadmedia', {
        body: Readable.from(encoder),
        searchParams: {
          f: 'json'
        },
        headers: encoder.headers,
      }).json<{
        BaseResponse: BaseResponse,
        MediaId: string,
      }>();
      if (BaseResponse.Ret) {
        throw new Error(`failed to upload: ${BaseResponse.ErrMsg}`);
      }
      mediaId = MediaId;
    }
    if (!mediaId) {
      throw new Error('failed to get media id');
    }
    return mediaId;
  }

  async sendText(content: string, to: string) {
    await this.send('webwxsendmsg', {
      Type: MsgType.TEXT,
      Content: content,
      ToUserName: to,
    });
  }

  async sendEmoji(content: Buffer, to: string) {
    await this.send('webwxsendemoticon', {
      Type: MsgType.EMOTICON,
      MediaId: await this.upload(content, MsgType.UNKNOWN, to),
      ToUserName: to,
      EmojiFlag: 2,
    }, {
      searchParams: {
        fun: 'sys',
      }
    });
  }

  async sendImage(content: Buffer, to: string) {
    await this.send('webwxsendmsgimg', {
      Type: MsgType.IMAGE,
      MediaId: await this.upload(content, MsgType.IMAGE, to),
      ToUserName: to,
    }, {
      searchParams: {
        fun: 'async',
        f: 'json'
      }
    });
  }

  async sendVideo(content: Buffer, to: string) {
    await this.send('webwxsendvideomsg', {
      Type: MsgType.VIDEO,
      MediaId: await this.upload(content, MsgType.VIDEO, to),
      ToUserName: to,
    }, {
      searchParams: {
        fun: 'async',
        f: 'json'
      }
    });
  }

  async sendDocument(filename: string, content: Buffer, to: string) {
    await this.send('webwxsendappmsg', {
      Type: AppMsgType.ATTACH,
      ToUserName: to,
      Content: `<appmsg appid='' sdkver=''><title>${filename}</title><des></des><action></action><type>${AppMsgType.ATTACH}</type><content></content><url></url><lowurl></lowurl><appattach><totallen>${content.length}</totallen><attachid>${await this.upload(content, MsgType.UNKNOWN, to)}</attachid><fileext>${filename.match(/(?:\.([^.]+))?$/)?.[1] ?? ''}</fileext></appattach><extinfo></extinfo></appmsg>`
    }, {
      searchParams: {
        fun: 'async',
        f: 'json',
        mod: 'desktop',
      }
    });
  }
}
