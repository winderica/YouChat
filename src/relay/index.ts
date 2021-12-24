import { Location, Multimedia, Text } from '../type';

export interface Receiver {
  receiveTextFromRelay(message: Text): unknown;
  receiveStickerFromRelay(sticker: Multimedia): unknown;
  receiveImageFromRelay(image: Multimedia): unknown;
  receiveVideoFromRelay(video: Multimedia): unknown;
  receiveDocumentFromRelay(document: Multimedia): unknown;
  receiveVoiceFromRelay(voice: Multimedia): unknown;
  receiveLocationFromRelay(location: Location): unknown;
}

export abstract class Relay<R extends Receiver> {
  protected abstract bot: any;
  receiver!: R;

  abstract start(): unknown;

  setReceiver(receiver: R) {
    this.receiver = receiver;
  }

  sendTextToRelay(message: Text) {
    this.receiver.receiveTextFromRelay(message);
  }

  sendStickerToRelay(sticker: Multimedia) {
    this.receiver.receiveStickerFromRelay(sticker);
  }

  sendImageToRelay(image: Multimedia) {
    this.receiver.receiveImageFromRelay(image);
  }

  sendVideoToRelay(video: Multimedia) {
    this.receiver.receiveVideoFromRelay(video);
  }

  sendDocumentToRelay(document: Multimedia) {
    this.receiver.receiveDocumentFromRelay(document);
  }

  sendVoiceToRelay(voice: Multimedia) {
    this.receiver.receiveVoiceFromRelay(voice);
  }

  sendLocationToRelay(location: Location) {
    this.receiver.receiveLocationFromRelay(location);
  }
}
