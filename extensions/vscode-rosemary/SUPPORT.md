# Support

ROSEMARY を試していただきありがとうございます。

## 問題を報告する前に

まず以下を確認してください。

- ファイル拡張子が `.rsmr` であることを確認してください。
- `.rsmr` エディタから `ROSEMARY: Open Preview` を実行してください。
- VS Code の Problems panel で ROSEMARY の診断結果を確認してください。
- `@include` が関係している場合、include path が directive を含むファイルからの相対パスであり、`.rsmr` ファイルを指していることを確認してください。
- 小さな `.rsmr` ファイルで問題を再現できるか試してください。

## 報告に含める内容

問題を報告する際は、以下を含めてください。

- ROSEMARY 拡張機能のバージョン
- VS Code のバージョン
- 使用している OS
- 問題を再現できる最小の `.rsmr` サンプル
- 期待される動作
- 実際の動作
- Problems panel に表示されている診断結果

## セキュリティまたはプライバシーに関する懸念

ROSEMARY は `.rsmr` の内容を外部サービスへ送信しません。include の解決のためにローカルの `.rsmr` ファイルを読み込み、preview は VS Code 内でローカルに描画されます。

セキュリティまたはプライバシー上の問題を発見したと思われる場合は、非公開のプロジェクト内容を公開の場に投稿しないでください。可能な限り小さな再現例を共有するか、機密性のある物語素材を含めずに動作を説明してください。

## 一般公開版のサポート窓口

Marketplace release では、Marketplace Q&A または GitHub Issues を使用してください。

- Repository: https://github.com/I-Sora/Rosemary
- Issues: https://github.com/I-Sora/Rosemary/issues

private VSIX build では、その VSIX を受け取った channel を通じて問題を報告してください。

---

# Support

## English

Thank you for trying ROSEMARY.

## Before Reporting a Problem

Please check the following first:

- Confirm the file extension is `.rsmr`.
- Run `ROSEMARY: Open Preview` from a `.rsmr` editor.
- Check the VS Code Problems panel for ROSEMARY diagnostics.
- If `@include` is involved, confirm that the include path is relative to the file containing the directive and points to a `.rsmr` file.
- Try reproducing the issue with a small `.rsmr` file.

## What to Include in a Report

When reporting an issue, include:

- ROSEMARY extension version
- VS Code version
- Operating system
- A minimal `.rsmr` sample that reproduces the issue
- The expected behavior
- The actual behavior
- Any diagnostics shown in the Problems panel

## Security or Privacy Concerns

ROSEMARY does not send `.rsmr` content to external services. It reads local `.rsmr` files for include resolution and renders previews locally in VS Code.

If you believe you have found a security or privacy problem, avoid posting private project content publicly. Share the smallest possible reproduction or describe the behavior without sensitive story material.

## Public Release Support Channel

For a Marketplace release, use the Marketplace Q&A or GitHub Issues.

- Repository: https://github.com/I-Sora/Rosemary
- Issues: https://github.com/I-Sora/Rosemary/issues

For private VSIX builds, report issues through the channel where you received the VSIX.
