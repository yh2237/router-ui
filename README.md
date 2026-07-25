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
- 接続履歴の再利用（パスワード・秘密鍵は保存しません）
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

設定を書き換える操作は、確認・差分・保存の安全なフローが未実装のため、専用UIからは実行しません。必要な場合はターミナルを使用してください。

## インストール

### 必要なもの

- Node.js 22以降
- 接続先ルーターへのネットワーク到達性
- SSHまたはTelnetが有効な管理アカウント

```bash
git clone https://github.com/yh2237/router-ui.git
cd router-ui
npm install
```

### 本番・常時運用

```bash
npm run build
npm start
```

起動後、`http://localhost:3000` を開いて接続先の機種、ホスト、ポート、認証情報を入力します。

デフォルトの待受ポートは3000です。変更する場合は環境変数を指定します。

```bash
PORT=8080 npm start
```

常時運用では、systemd、Docker、PM2などで `npm start` を監視・再起動する構成を推奨します。
`npm start` はプロジェクトのルートディレクトリで実行してください。ビルド成果物に加えて、機種定義の`devices/`と静的ファイルの`web/`を実行時に使用します。

ビルド後に開発依存を外す場合は、次のようにできます。

```bash
npm prune --omit=dev
npm start
```

### 開発

```bash
npm install
npm run dev
```

開発時は`tsx`がTypeScriptを直接実行し、ファイル変更時に再起動します。本番では`npm run build`で生成した`dist/`内のJavaScriptをNode.jsで実行します。

## 接続先の準備

接続先ルーターでSSHまたはTelnetを有効にし、router-uiを動かすホストから到達できるようにしてください。たとえばYAMAHA RTXでSSHを有効にする場合は、機種・ファームウェアのマニュアルを確認したうえで次の設定を行います。

```text
sshd service on
save
```

管理インターフェースをインターネットへ公開せず、信頼できるローカルネットワークまたはVPN内で使用してください。

## モデル追加・パネル素材

利用方法やモデル追加時の仕様は以下を参照してください。

- [デバイス前面パネル定義](docs/device-panels/panel-schema.md)
- [PNGパーツ制作ルール](docs/device-panels/asset-guidelines.md)

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
