# デバイス前面パネル定義

モデル固有のポートとLED配置を、共通パネルレンダラーへ渡すためのYAMLです。
`devices/models.yaml` の `panel` に、拡張子を除いたファイル名を指定します。

```yaml
- model: "RTX1210"
  series: "yamaha-rtx"
  panel: "yamaha-rtx1210"
```

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
位置は自由です。PNG部品を使用する形式へ移行する場合も、座標と状態ソースは同じ考え方を
維持します。

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
