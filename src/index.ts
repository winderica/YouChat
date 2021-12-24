import { TelegramRelay } from './relay/telegram';
import { WeChatRelay } from './relay/wechat';

(async () => {
  const telegramRelay = new TelegramRelay();
  const weChatRelay = new WeChatRelay();

  telegramRelay.setReceiver(weChatRelay);
  weChatRelay.setReceiver(telegramRelay);

  telegramRelay.start();
  await weChatRelay.start();
})();
