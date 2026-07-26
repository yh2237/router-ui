# デバイス前面パネル定義

モデル固有のポートとLED配置を、共通パネルレンダラーへ渡すためのYAMLです。
`devices/models.yaml` の `panel` に、拡張子を除いたファイル名を指定します。

```yaml
- model: "RTX1210"
  series: "yamaha-rtx"
  panel: "yamaha-rtx1210"
```

## PNGパネル（schemaVersion 2）

Figmaから生成するパネルは`schemaVersion: 2`を使用します。背景と状態付き部品は
`devices/parts/<vendor>.yaml`の部品IDを参照します。

```yaml
schemaVersion: 2
model: "RTX1210"
width: 750
height: 256
theme: "yamaha"
brand: "YAMAHA"
background:
  part: "yamaha.background.rtx1210"
  x: 0
  y: 0
  width: 750
  height: 256
elements:
  - type: "port"
    id: "lan1.1"
    label: "1"
    part: "yamaha.port.rj45-type-01"
    x: 180.5
    y: 47
    width: 64
    height: 64
    statusSource: "interface.lan1.port.1"
```

PNGはSVG内の`image`要素として重ねるため、パネル全体はレスポンシブに拡大縮小されます。
状態が変わると部品カタログの`states`から別のPNGを選択します。

上下反転したポートは要素に`rotation: 180`を指定します。回転中心は部品の中央です。

```yaml
- type: "port"
  id: "lan1.5"
  part: "yamaha.port.rj45-type-01"
  x: 180.5
  y: 111
  width: 64
  height: 64
  rotation: 180
  statusSource: "interface.lan1.port.5"
```

Figmaからの生成手順は[Figmaパネルエクスポーター設計](figma-exporter.md)を参照してください。

## Coordinate system

`width` と `height` がパネルの論理座標系になります。すべての要素は独立した `x` / `y`
座標を持つため、LEDを下部へ横一列、左側へ縦一列、ポートの間へ配置することもできます。

```yaml
model: "EXAMPLE"
width: 760
height: 280
theme: "neutral"

elements:
  - type: "led"
    id: "power"
    label: "POWER"
    x: 35
    y: 60
    statusSource: "system.power"
    align: "right"

  - type: "led"
    id: "alarm"
    label: "ALARM"
    x: 35
    y: 95
    statusSource: "system.alarm"
    align: "right"
```

`align` はLEDから見たラベルの位置で、`top`、`right`、`bottom`、`left`を指定できます。

## Element types

- `label`: ブランド名、モデル名、注釈
- `port`: RJ45、コンソール、USB、SFPなどの単独ポート
- `port-group`: スイッチポートの行列
- `led`: 状態ランプ

`port-group` は `columns`、ポートサイズ、縦横の間隔を指定します。グループそのものの
位置は自由です。Figmaエクスポーターは個々のInstance位置を保持するため、初期版では
`port-group`へ圧縮せず、個別の`port`として生成します。

## State sources

`statusSource` は、機器から取得した状態と表示要素を結びつける安定したキーです。

```text
interface.lan1
interface.lan1.port.1
interface.lan2
system.power
system.alarm
storage.usb
```

状態は `up`、`down`、`warning`、`error`、`unknown` のいずれかへ正規化されます。
物理スイッチポートの状態を取得できなかった場合、論理インターフェース全体の状態から
推測せず `unknown` として表示します。
