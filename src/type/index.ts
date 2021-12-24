interface Message<T> {
  content: T;
  from: string;
  to: string;
  peer: string;
}

export class Text implements Message<string> {
  constructor(
    public content: string,
    public to: string,
    public from = '',
    public peer = '',
  ) {
  }
}

export class Multimedia implements Message<Buffer> {
  constructor(
    public content: Buffer,
    public to: string,
    public filename?: string,
    public from = '',
    public peer = '',
  ) {
  }
}

export class Location implements Message<[number, number]> {
  constructor(
    public content: [number, number],
    public to: string,
    public from = '',
    public peer = '',
  ) {
  }
}
