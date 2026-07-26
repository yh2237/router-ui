# Figmaパネルエクスポーター設計

Figmaで管理する前面パネル、共通部品、Variantsを、router-uiで使用するPNGと
パネル定義へ変換するための設計です。

## 目的

- Figmaをパネル外観と配置の原本にする
- Component / Variantから状態別PNGを生成する
- 完成パネル上のInstanceから座標とサイズを生成する
- 機器状態との対応は、レビュー可能なYAMLとしてリポジトリ側で管理する
- 同じ部品を複数モデルで共有し、画像をモデルごとに複製しない

Figma MCPは構造確認や設計レビューには使用できますが、Starterプランでは読み取り回数が
少ないため、定常的なエクスポート処理の依存先にはしません。

## 全体構成

```text
Figma Design
  │
  │ Figma Plugin: Export router panel
  ▼
yamaha-rtx1210.router-panel.json
  ├─ panel / instances   Figma由来の座標、Instance、Variant情報
  └─ parts[].variants    Component / VariantのPNG（base64）
       │
       │ npm run panel:import
       ▼
Repository importer
  ├─ 意味情報をbindings YAMLから結合
  ├─ スキーマ、座標、状態、ファイル名を検証
  └─ 差分を表示してから生成物を更新
       ▼
web/img/device-panels/...       PNG
devices/parts/...               部品カタログ
devices/panels/...              モデル別パネル定義
```

Figma PluginとRepository importerを分離します。Figma側は見た目と配置だけを扱い、
`statusSource`のようなrouter-ui固有の意味はリポジトリ側で管理します。これにより、
Figmaのレイヤー名変更だけで実機状態との対応が壊れることを防ぎます。

## Figma側の規約

### 完成パネル

モデルごとに、次の子Frameを持つ完成Frameを1つ用意します。

```text
Yamaha_RTX1210
├─ Yamaha_RTX1210       背景ComponentのInstance
├─ Label                動的なテキスト
├─ Lamp                 ランプ部品のInstance
└─ Port                 ポートグループ
   ├─ Console
   ├─ LAN1
   ├─ LAN2
   ├─ LAN3
   └─ ISDN
```

完成パネルに配置する状態付き部品は必ずInstanceにします。通常のFrameやVectorを直接置いた
場合、エクスポーターは警告します。背景など状態を持たない大きな部品もComponent化します。

### 部品とVariants

状態付き部品はComponent Setにし、Variant propertyを`state`とします。

```text
RJ45
├─ state=down
├─ state=up
├─ state=warning
└─ state=error

RJ45_Console
├─ state=down
├─ state=up
├─ state=warning
└─ state=error

Yamaha_Lamp01
├─ state=down
├─ state=up
├─ state=warning
└─ state=error
```

- 同じComponent Set内のVariantは幅、高さ、内部原点を一致させる
- `state`は小文字のASCIIにする
- `state`は`down`、`up`、`warning`、`error`の4種類をすべて用意する
- 状態切り替えで外形や余白を変更しない
- Export対象にラベルやポート番号を含めない
- 完成パネル上のInstance名は論理名にする

状態取得前を表す`unknown`はrouter-ui内部だけの状態です。Figmaには`unknown` Variantを作らず、
bindingsで`down`画像へ対応させます。背景のように状態を持たない部品はComponent Setではなく、
単一のComponentとして`base`画像を書き出します。

例:

```text
Lamp/POWER
Lamp/ALARM
Port/LAN1/Port_1
Port/LAN1/Port_2
```

### 座標と倍率

Figmaでは2倍解像度で制作します。RTX1210の完成Frameが1500×512の場合、router-uiの論理
サイズは750×256です。

```text
logical coordinate = figma coordinate / sourceScale
sourceScale = 2
```

PNGはFigma上のピクセル寸法のまま書き出し、ブラウザでは論理サイズで表示します。除算後に
端数が出る座標は許可しますが、小数第3位で丸めます。

Instanceの`0`度と`180`度回転に対応します。負の幅・高さ、非等倍スケール、90度など
その他の回転、親Frameからのはみ出しは初期版ではエラーにします。

## Pluginの導入と実行

1. Figma Desktopで`Plugins` → `Development` → `Import plugin from manifest...`を開く
2. `tools/figma-panel-exporter/manifest.json`を選択する
3. 完成パネルFrameを1つ選択する
4. Development pluginsから`router-ui Panel Exporter`を実行する
5. 制作倍率`2`を確認してエクスポートする

出力される`.router-panel.json`にはPNGのbase64が含まれるため、サイズは通常のJSONより
大きくなります。この中間ファイルはレビューや受け渡し用であり、リポジトリへコミットする
必要はありません。

Figma Communityの`Figma Raw`など、別の構造エクスポートPluginは使用できません。今回の
インポーターには座標と状態別PNGが必要なため、必ずこのリポジトリに含まれる
`router-ui Panel Exporter`から書き出してください。

## 中間形式

PluginはFigma固有情報を単一のJSONバンドルへ正規化します。

```json
{
  "formatVersion": 1,
  "source": {
    "fileKey": "MKgpHDgeUib3ZwgL6wMzs8",
    "pageId": "0:1",
    "panelNodeId": "1:214",
    "exportedAt": "2026-07-26T00:00:00.000Z"
  },
  "panel": {
    "name": "Yamaha_RTX1210",
    "width": 1500,
    "height": 512,
    "sourceScale": 2
  },
  "parts": [
    {
      "name": "RJ45",
      "kind": "port",
      "width": 128,
      "height": 128,
      "variants": [
        { "state": "down", "width": 128, "height": 128, "data": "<base64 PNG>" },
        { "state": "up", "width": 128, "height": 128, "data": "<base64 PNG>" },
        { "state": "warning", "width": 128, "height": 128, "data": "<base64 PNG>" },
        { "state": "error", "width": 128, "height": 128, "data": "<base64 PNG>" }
      ]
    }
  ],
  "instances": [
    {
      "path": "Port/LAN1/Port_1",
      "name": "Port_1",
      "component": "RJ45",
      "variant": { "state": "down" },
      "x": 361,
      "y": 94,
      "width": 128,
      "height": 128,
      "rotation": 180
    },
    {
      "path": "Lamp/POWER",
      "name": "POWER",
      "component": "Yamaha_Lamp01",
      "variant": { "state": "down" },
      "x": 121,
      "y": 439,
      "width": 64,
      "height": 24
    }
  ],
  "labels": [
    {
      "path": "Label/POWER",
      "text": "POWER",
      "x": 93,
      "y": 368,
      "width": 120,
      "height": 49
    }
  ]
}
```

座標はすべて完成パネル左上を原点とした絶対座標へ変換して保存します。Figma APIが返す
子Frame内の相対座標を、そのまま出力には使用しません。

## 意味情報のbindings

Figmaから自動判定できない情報は、モデル別bindingsで管理します。

保存先:

```text
devices/panel-bindings/yamaha-rtx1210.yaml
```

例:

```yaml
formatVersion: 1
panel:
  match: "Yamaha_RTX1210"
  model: "RTX1210"
  brand: "YAMAHA"
  vendor: "yamaha"
  theme: "yamaha"
  sourceScale: 2
  background:
    instance: "Yamaha_RTX1210"
    part: "yamaha.background.rtx1210"

parts:
  RJ45:
    id: "yamaha.port.rj45-type-01"
    kind: "port"
    stateMap:
      unknown: down
      down: down
      up: up
      warning: warning
      error: error
  RJ45_Console:
    id: "yamaha.port.console-type-01"
    kind: "port"
    stateMap:
      unknown: down
      down: down
      up: up
      warning: warning
      error: error
  Yamaha_Lamp01:
    id: "yamaha.led.system-type-01"
    kind: "led"
    stateMap:
      unknown: down
      down: down
      up: up
      warning: warning
      error: error

elements:
  "Port/Console/Port_1":
    id: "console"
    label: "CONSOLE"
    statusSource: "system.console"
  "Port/LAN1/Port_1":
    id: "lan1.1"
    label: "1"
    statusSource: "interface.lan1.port.1"
  "Lamp/POWER":
    id: "power"
    label: "POWER"
    statusSource: "system.power"
```

`path`を主キーにして、表示文字列ではなく階層を含む名前で照合します。未定義Instanceは
暗黙に無視せずエラーにし、意図的に出力しないものだけ`ignore`へ明記します。

`stateMap`はrouter-ui内部の状態をFigma Variantへ対応させます。`unknown`だけは状態取得前を
表す内部状態なので`down`へ割り当て、それ以外は同名のVariantへ割り当てます。

## 出力スキーマ v2

PNG部品を参照できるよう、現在のパネルYAMLを次の形へ拡張します。

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

  - type: "led"
    id: "power"
    label: "POWER"
    part: "yamaha.led.system-type-01"
    x: 60.5
    y: 219.5
    width: 32
    height: 12
    statusSource: "system.power"
```

部品カタログはランタイム状態をPNGへ対応させます。

```yaml
schemaVersion: 1
vendor: "yamaha"
parts:
  yamaha.led.system-type-01:
    kind: "led"
    size: [32, 12]
    states:
      unknown: "/img/device-panels/yamaha/leds/system-type-01/down.png"
      down: "/img/device-panels/yamaha/leds/system-type-01/down.png"
      up: "/img/device-panels/yamaha/leds/system-type-01/up.png"
      warning: "/img/device-panels/yamaha/leds/system-type-01/warning.png"
      error: "/img/device-panels/yamaha/leds/system-type-01/error.png"
```

`port-group`はFigma上の個別Instance座標を失わないよう、初期版では個別`port`へ展開します。
将来、完全な格子配置だと検証できた場合のみ圧縮表現を生成できます。

## Pluginの処理

1. ユーザーが完成パネルFrameを選択する
2. 選択が単一Frameであることを確認する
3. 子孫のInstance、Text、Component Setを収集する
4. 各Instanceの座標を完成パネル基準へ変換する
5. Instanceの回転角を`0`または`180`度へ正規化する
6. Component Setの`state` Variantを列挙する
7. Variantを透過PNGで`exportAsync({ format: "PNG" })`する
8. 背景ComponentをPNGで書き出す
9. 構造とbase64 PNGを単一の`.router-panel.json`にまとめる
10. エラーと警告の一覧をPlugin UIへ表示する

Pluginはリポジトリへ直接書き込みません。Plugin UIからJSONを保存するだけにして、Figmaから
ローカルファイルシステムへの権限やパス依存を持たせません。

## Repository importerの処理

想定コマンド:

```bash
npm run panel:import -- \
  --bundle ./yamaha-rtx1210.router-panel.json \
  --bindings devices/panel-bindings/yamaha-rtx1210.yaml \
  --check

npm run panel:import -- \
  --bundle ./yamaha-rtx1210.router-panel.json \
  --bindings devices/panel-bindings/yamaha-rtx1210.yaml \
  --write
```

`--check`はファイルを書き換えず、生成予定の差分と検証結果を表示します。`--write`だけが
PNG、部品カタログ、パネルYAMLを更新します。

旧`on` / `off` Variantから移行するときは、Figma上で4状態へ変更してから新しいバンドルを
書き出します。既存の`on.png` / `off.png`は、新しいバンドルを`--write`するまでは現在の
部品カタログから参照されるため、先に削除しないでください。新しい生成物の表示確認後、
部品カタログから参照されなくなった旧PNGだけを削除できます。

処理順:

1. バンドル全体とPNGごとのサイズ上限、base64、PNGヘッダーを検査
2. バンドルのバージョンと必須項目を検査
3. bindingsを読み込み、全Instanceが一意に対応することを確認
4. 座標とサイズを`sourceScale`で論理値へ変換
5. PNGヘッダーと宣言寸法を確認
6. 状態マッピングの欠落と危険なフォールバックを確認
7. 一時ディレクトリへ全生成物を作成
8. 既存生成物との差分を表示
9. `--write`の場合のみ対象ファイルを置き換える

## 検証ルール

エラー:

- 完成パネルが単一Frameでない
- 同じ階層内に同名Instanceがある
- bindingsにないInstance、または存在しないbindings pathがある
- Component Setに`state` propertyがない
- Component Setに`down`、`up`、`warning`、`error`の不足、重複、または別名の状態がある
- Variant間でPNG寸法が異なる
- 座標やサイズが有限数でない
- 要素が完成パネルの範囲外へ出る
- 同じ`id`または`statusSource`の意図しない重複
- 出力パスが許可されたディレクトリ外を指す

警告:

- ラベルとInstanceの名前が一致しない
- 未使用Component / Variantがある
- 座標がsourceScaleで割り切れない
- Figmaフォントをrouter-uiのCSSトークンへ対応できない

## 差分と再現性

- JSONとYAMLのキー順、要素順、数値の丸め方を固定する
- PNG以外にFigmaの一時URLやアクセストークンを保存しない
- `exportedAt`は中間JSONだけに含め、コミット対象の生成物には含めない
- 出力前にPNGを同じ設定で正規化し、不要なメタデータを除去する
- bindingsと中間形式が同じなら、常に同一のYAMLを生成する
- Figmaのnode IDは監査情報として保持しても、生成物の主キーには使用しない

## 実装順

1. パネルスキーマv2と部品カタログのTypeScript型、ローダー、テスト
2. PNG部品を重ねるHTMLレンダラー
3. bindingsスキーマとRepository importerの`--check`
4. 固定fixtureバンドルを使ったimportテスト
5. Figma Pluginの構造抽出とJSONバンドル生成
6. Component / VariantのPNG Export
7. JSONバンドル生成と`--write`
8. RTX1210で見た目と状態切り替えを確認
9. 別配置のNEC IXを追加し、モデル非依存性を確認

実機状態の取得やルーターへのコマンド送信は、このエクスポーターの責務に含めません。
RTX1210実機へ接続せず、fixtureの状態データだけで表示確認します。
