# PNGパーツ制作ルール

デバイス前面パネルで使用するLED、ポート、スイッチなどのPNG素材を制作する際のルールです。

## 保存場所

```text
web/img/device-panels/
├─ yamaha/
│  ├─ backgrounds/
│  ├─ leds/
│  │  ├─ type-01/
│  │  │  ├─ off.png
│  │  │  ├─ on.png
│  │  │  ├─ warning.png
│  │  │  └─ error.png
│  │  └─ type-02/
│  └─ ports/
│     ├─ rj45-type-01/
│     │  ├─ unknown.png
│     │  ├─ down.png
│     │  └─ up.png
│     ├─ console-type-01/
│     ├─ usb-type-01/
│     └─ sfp-type-01/
└─ nec/
   ├─ backgrounds/
   ├─ leds/
   └─ ports/
```

ベンダー、部品の種類、外観タイプ、状態の順に分けます。モデルごとに同じ画像を複製せず、
同じ外観の部品は複数モデルで共有します。

## 画像仕様

- PNG形式、透過背景
- 同じ部品の状態違いはキャンバスサイズを完全に統一
- 状態を切り替えても部品本体の位置と大きさを変えない
- ラベル文字やポート番号は画像へ焼き込まず、パネル定義側で表示
- 影や発光を含める場合も、すべての状態で同じキャンバス範囲に収める
- ブラウザでの論理表示サイズに対して2倍の解像度を推奨
- 不要な余白を付けず、部品の基準点を状態間で揃える
- ファイル名は半角小文字、数字、ハイフンのみ

例として、表示サイズが24×12pxのLEDは48×24pxで制作します。

## 状態名

LED:

- `off`: 消灯
- `on`: 正常点灯
- `warning`: 警告
- `error`: 異常
- 必要な場合のみ `activity`: 通信中

ポート:

- `unknown`: 状態を取得できていない
- `down`: リンクダウン
- `up`: リンクアップ
- 必要な場合のみ `warning`、`error`

取得できない状態を推測で`up`にしないでください。

## 色と見分けやすさ

- 色だけでなく、明るさや発光の有無でも状態を区別
- `off`と`unknown`を同一画像にする場合、UI上の説明で区別
- 赤は異常、黄は警告、緑は正常状態に限定
- 背景色の異なるモデルでも輪郭が消えないようにする
- 極端に強いぼかしや発光を避け、小さい表示でも形が残るようにする

## 部品カタログ

モデル別パネルYAMLに画像パスを直接並べず、部品カタログで状態と画像を対応させます。

```yaml
vendor: yamaha

parts:
  yamaha.led.type-01:
    kind: led
    size: [24, 12]
    states:
      unknown: /img/device-panels/yamaha/leds/type-01/off.png
      off: /img/device-panels/yamaha/leds/type-01/off.png
      on: /img/device-panels/yamaha/leds/type-01/on.png
      warning: /img/device-panels/yamaha/leds/type-01/warning.png
      error: /img/device-panels/yamaha/leds/type-01/error.png
```

画像の差し替えやディレクトリ変更は部品カタログ内で完結させます。
