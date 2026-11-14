```
pnpm install
pnpm dev
```

```
open http://localhost:3000
```

`GET /cache-demo` は乱数と生成日時を Valkey に10秒間保存します。
起動前にリポジトリ直下で `docker compose up -d --wait` を実行してください。
操作例・接続設定は [ルートの README](../README.md#1-キャッシュ) を参照してください。

テストは `pnpm test`、ビルドは `pnpm build` で実行します。

## フォーマット・Lint

Biome で `src/`・`test/` の TypeScript と `app/` 直下の JSON をチェックします。
インデントはスペース2つ、文字列はシングルクォート、セミコロンは必要な場合のみ付けます。

```sh
pnpm check      # フォーマット・Lint・import 順の確認
pnpm check:fix  # 自動修正
pnpm format    # フォーマットのみ適用
pnpm lint      # Lint のみ確認
```
