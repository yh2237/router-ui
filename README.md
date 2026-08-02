# router-ui

YAMAHA RTX と NEC IX のCLIを、SSH/Telnet経由でブラウザから操作するためのセルフホスト型UIです。

## 現在の対応機種

| ベンダー | 機種 | 接続方式 | 状態 |
| --- | --- | --- | --- |
| YAMAHA | RTX1210 | SSH | 実機対応・パネル表示対応 |
| YAMAHA | RTX1220 | SSH | コマンド画面対応 |
| NEC | IX2215 | Telnet | 基本コマンド定義済み・実機検証予定 |
| NEC | IX2205 | Telnet | 基本コマンド定義済み・実機検証予定 |

対応機種は `devices/models.yaml` から読み込みます。機種ごとの差分やコマンド追加はYAMLで定義できます。

## 機能

### 共通

- SSHまたはTelnetでの接続
- パスワード認証、PEM形式の秘密鍵認証
- 接続履歴の再利用とローカル永続化（パスワード・秘密鍵は保存しません）
- SSHホスト鍵のTOFU検証。初回接続時にフィンガープリントを保存し、変更時は接続を拒否
- ブラウザーセッションごとの機器接続分離と、アイドル接続の自動切断
- コマンド実行の直列化。ダッシュボード更新とターミナル操作の応答が混在しない設計
- ブラウザ内ターミナル。任意のCLIコマンド実行と上下キーによる履歴操作

### YAMAHA RTX

- ダッシュボード
  - システム情報、LANインターフェース、リソース使用量、トラフィック、IPv4経路
  - RTX1210では前面パネル配置に沿ったインターフェース表示
- 参照コマンド
  - ARP・IPv6近隣、DHCP・DNS、IPv4接続、NATセッション
  - PP・トンネル・IPsec SA、IPv4／IPv6経路
  - システムログ、コマンド履歴、ログインユーザー、SSHホスト鍵
  - 現在の設定、未保存の設定差分
- 診断
  - 入力値を検証したPingとTraceroute
- 設定変更
  - 時刻、インターフェースIP、LAN動作モード、ルーティング
  - NAT、DNS、DHCP
  - ログ・SYSLOG、SNMP、UPnP
  - IPv4フィルター、HTTP URLフィルター
  - PPPoEプロバイダー接続、IPsecサイト間VPN
  - SSH/SFTP経由の設定ファイル読込と自動ロールバック
  - 生成コマンドの事前確認
  - 適用前後の`show config`差分
  - 適用と起動設定への保存を分離
  - パスワードと事前共有鍵のプレビュー・差分マスキング

今後追加する設定カテゴリと安全な操作フローは[設定変更UI](docs/settings.md)を参照してください。

## インストール

### 必要なもの

- Node.js 22以降
- 接続先ルーターへのネットワーク到達性
- SSHまたはTelnetが有効な管理アカウント

```bash
git clone https://github.com/yh2237/router-ui.git
cd router-ui
npm ci
```

### 本番・常時運用

```bash
npm run build
npm start
```

起動後、`http://127.0.0.1:3000` を開いて接続先の機種、ホスト、ポート、認証情報を入力します。

デフォルトでは`127.0.0.1:3000`だけで待ち受けます。ポートを変更する場合は環境変数を指定します。

```bash
PORT=8080 npm start
```

同じLAN内の別の端末からアクセスする場合は、LAN側でも待ち受けます。

```bash
HOST=0.0.0.0 npm start
```

Router UI自体にはログイン機能を設けていません。`HOST=0.0.0.0`で起動する場合は、信頼できる管理LANまたはVPN内に限定してください。

常時運用では、systemd、Docker、PM2などで `npm start` を監視・再起動する構成を推奨します。
`npm start` はプロジェクトのルートディレクトリで実行してください。ビルド成果物に加えて、機種定義の`devices/`と静的ファイルの`web/`を実行時に使用します。

HTMXとWebフォントはnpm依存からローカル配信するため、実行時にも`node_modules/`が必要です。外部CDNへの通信は行いません。

ビルド後に開発依存を外す場合は、次のようにできます。

```bash
npm prune --omit=dev
npm start
```

### 運用データ

接続履歴とSSHホスト鍵は、デフォルトでプロジェクト直下の`data/`へ保存します。認証情報、パスワード、秘密鍵は保存しません。

保存先を変更する場合は`ROUTER_UI_DATA_DIR`を指定します。

```bash
ROUTER_UI_DATA_DIR=/var/lib/router-ui npm start
```

保存先ディレクトリはrouter-uiの実行ユーザーだけが読み書きできるようにしてください。SSHホスト鍵が正当な機器交換などで変わった場合は、接続画面の「保存済みSSHホスト鍵」から対象だけを削除し、次回接続時に新しいフィンガープリントを保存します。

接続は操作がない状態で30分経過すると自動的に切断されます。変更する場合は分単位で指定します。

```bash
ROUTER_UI_CONNECTION_IDLE_MINUTES=60 npm start
```

ブラウザーセッションの有効期限は、最後の操作から12時間です。変更する場合は時間単位で指定します。

```bash
ROUTER_UI_SESSION_HOURS=24 npm start
```

### 開発

```bash
npm ci
npm run dev
```

開発時は`tsx`がTypeScriptを直接実行し、ファイル変更時に再起動します。本番では`npm run build`で生成した`dist/`内のJavaScriptをNode.jsで実行します。

## 接続先の準備

接続先ルーターでSSHまたはTelnetを有効にし、router-uiを動かすホストから到達できるようにしてください。たとえばYAMAHA RTXでSSHを有効にする場合は、機種・ファームウェアのマニュアルを確認したうえで次の設定を行います。

```text
sshd service on
save
```

管理インターフェースをインターネットへ公開せず、信頼できるローカルネットワークまたはVPN内で使用してください。LANへ公開する場合は、必要に応じてリバースプロキシなどで認証を追加してください。

## モデル追加・パネル素材

利用方法やモデル追加時の仕様は以下を参照してください。

- [デバイス前面パネル定義](docs/device-panels/panel-schema.md)
- [PNGパーツ制作ルール](docs/device-panels/asset-guidelines.md)
- [Figmaパネルエクスポーター設計](docs/device-panels/figma-exporter.md)
- [設定変更UIと実装予定](docs/settings.md)

Figmaから前面パネルを更新する場合は、`tools/figma-panel-exporter/manifest.json`を
Figma DesktopのDevelopment pluginとして読み込み、完成パネルFrameを書き出します。

```bash
npm run panel:import -- \
  --bundle ./yamaha-rtx1210.router-panel.json \
  --bindings devices/panel-bindings/yamaha-rtx1210.yaml \
  --check
```

差分を確認した後、`--check`を`--write`へ変更するとPNG、部品カタログ、パネルYAMLを更新します。

実機への反復プローブには次を使います。接続先にコマンドを繰り返し送るため、検証用の機器で使用してください。

```bash
npm run probe:device -- \
  --model RTX1210 \
  --host 192.168.1.1 \
  --username admin \
  --password 'your-password' \
  --repeat 20
```

## 確認

```bash
npx tsc --noEmit
npm test
```

## セキュリティ上の注意

このツールは信頼できるローカルネットワークでセルフホストしてください。ターミナルは任意のCLIコマンドを送信できるため、設定変更や再起動などの操作も可能です。

Router UIには独自のログイン機能がありません。SameSite Cookie、ブラウザーセッションごとの接続所有権、CSRF・Origin検証、CSPなどの基本的な保護は行いますが、インターネットへは公開しないでください。

Telnetは通信を暗号化しません。NEC IXなどでTelnetを使う場合も、隔離された管理ネットワークまたはVPN内に限定してください。
