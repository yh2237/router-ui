# PNGパーツ制作ルール

デバイス前面パネルで使用するLED、ポート、スイッチなどのPNG素材を制作する際のルールです。

## 保存場所

```text
web/img/device-panels/
├─ yamaha/
│  ├─ backgrounds/
│  ├─ leds/
│  │  ├─ type-01/
│  │  │  ├─ down.png
│  │  │  ├─ up.png
│  │  │  ├─ warning.png
│  │  │  └─ error.png
│  │  └─ type-02/
│  └─ ports/
│     ├─ rj45-type-01/
│     │  ├─ down.png
│     │  ├─ up.png
│     │  ├─ warning.png
│     │  └─ error.png
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

Figmaの状態付き部品は、LEDとポートのどちらも次の4状態に統一します。

- `down`: 消灯またはリンクダウン
- `up`: 正常点灯またはリンクアップ
- `warning`: 警告
- `error`: 異常

router-ui内部には、状態をまだ取得できていないことを表す`unknown`もあります。これはFigmaの
Variantには作らず、通常は`down.png`へ割り当てます。状態を取得できていないときに
`up.png`を表示しないでください。

## 色と見分けやすさ

- 色だけでなく、明るさや発光の有無でも状態を区別
- `down`とランタイムの`unknown`を同一画像にする場合、UI上の説明で区別
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
      unknown: /img/device-panels/yamaha/leds/type-01/down.png
      down: /img/device-panels/yamaha/leds/type-01/down.png
      up: /img/device-panels/yamaha/leds/type-01/up.png
      warning: /img/device-panels/yamaha/leds/type-01/warning.png
      error: /img/device-panels/yamaha/leds/type-01/error.png
```

画像の差し替えやディレクトリ変更は部品カタログ内で完結させます。

## 制作対象チェックリスト

ポート本体と状態LEDは別PNGにします。たとえばRJ45ポートの`up`画像へLINK LEDを焼き込むと、
LINK/DATAとSPEEDの組み合わせごとに画像が必要になります。静的なソケットへLEDを重ねれば、
同じ部品をRTXの横一列配置とIXの縦配置の両方で再利用できます。

### RTX1210で最初に必要なもの

```text
web/img/device-panels/yamaha/
├─ backgrounds/
│  └─ rtx1210/
│     └─ base.png
├─ ports/
│  ├─ console-type-01/
│  │  └─ base.png
│  ├─ rj45-switch-type-01/
│  │  └─ base.png
│  └─ rj45-standalone-type-01/
│     └─ base.png
└─ leds/
   ├─ system-type-01/
   │  ├─ down.png
   │  ├─ up.png
   │  ├─ warning.png
   │  └─ error.png
   ├─ port-link-type-01/
   │  ├─ down.png
   │  ├─ up.png
   │  ├─ warning.png
   │  └─ error.png
   └─ port-speed-type-01/
      ├─ down.png
      ├─ up.png
      ├─ warning.png
      └─ error.png
```

- `backgrounds/rtx1210/base.png`
  - 筐体、前面パネル色、ネジ、区切り線など、状態を持たない背景
  - YAMAHAロゴ、RTX1210、LAN番号などの文字は焼き込まない
- `console-type-01/base.png`
  - CONSOLEコネクター本体
- `rj45-switch-type-01/base.png`
  - LAN1の8ポートで共用するRJ45ソケット
- `rj45-standalone-type-01/base.png`
  - LAN2、LAN3、ISDN S/Tで共用できる単独RJ45ソケット
  - ISDNの外観が異なる場合だけ`isdn-rj45-type-01/base.png`を追加
- `system-type-01`
  - POWER、ALARM、STATUS、microSD、USB、DOWNLOADで共用するメインランプ
- `port-link-type-01`
  - LINK/DATA表示用の小型ランプ
- `port-speed-type-01`
  - SPEED表示用の小型ランプ

RTX1210では、同じPNGを配置定義から繰り返し使用するため、LAN1用RJ45を8枚、システムLEDを
6セット複製して作る必要はありません。

### モデル追加時に必要になり得るもの

以下は搭載モデルを追加するときに、既存部品と外観が異なる場合だけ作ります。

```text
ports/
├─ rj45-switch-type-02/base.png
├─ rj45-standalone-type-02/base.png
├─ console-rj45-type-01/base.png
├─ console-mini-usb-type-01/base.png
├─ usb-a-type-01/base.png
├─ usb-c-type-01/base.png
├─ sfp-type-01/base.png
├─ sfp-plus-type-01/base.png
├─ microsd-type-01/base.png
└─ bri-type-01/base.png

leds/
├─ system-type-02/{down,up,warning,error}.png
├─ port-link-type-02/{down,up,warning,error}.png
├─ port-speed-type-02/{down,up,warning,error}.png
└─ round-type-01/{down,up,warning,error}.png

buttons/
├─ download-type-01/{normal,pressed,disabled}.png
├─ reset-type-01/{normal,pressed}.png
└─ eject-type-01/{normal,pressed}.png
```

### NEC IX向け

NEC IXでは状態ランプが左側へまとまるモデルがあるため、ポート用LEDとシステムLEDを同じ画像へ
まとめず、個別部品にします。

最初に必要になる候補は次の通りです。

- IX2205用の文字なし背景
- IX2215用の文字なし背景
- IX系RJ45ソケット
- IX系CONSOLEソケット
- IX系USBソケット
- 左側縦配置用のシステムLED
- ポートLINK用LED
- ポートSPEED用LED
- RESETなど、実際に前面へ存在するボタン

IX2205とIX2215で同じ外観の部品は共有し、背景と配置定義だけモデル別にします。正確な種類と
サイズは各モデルのパネルYAMLを作る段階で実機写真と寸法から確定します。

## PNGへ含めないもの

以下はモデル別パネル定義またはHTML/CSSで表示します。

- YAMAHA、NECなどのブランド名
- RTX1210、IX2215などのモデル名
- LAN1、LAN2、POWER、ALARMなどのラベル
- ポート番号
- 状態説明やツールチップ
- ポートグループの枠線

これらをPNGへ焼き込まないことで、同じ部品を異なるモデル、配置、表示倍率で再利用できます。
