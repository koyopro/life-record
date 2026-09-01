//! WebView が開こうとした URL を、どこで開くかの判定。
//!
//! 判定はここ（Rust 側）だけが持つ。WebView からは「移動しようとした」と
//! いう事実しか渡ってこないので、任意の URL をネイティブ API に流し込める
//! 経路を作らずに済む（docs/16-macos-app.md 16.5）。

use url::Url;

/// URL の行き先。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    /// Life Record 自身。Tauri のウィンドウの中で開く
    InApp,
    /// 外部。macOS の既定のアプリ（ブラウザ・メールなど）へ渡す
    Os,
    /// どちらでも開かない
    Blocked,
}

/// OS へ渡すスキーム。
///
/// 「http 以外はすべて OS へ」とはしない。`file:` や見知らぬ独自スキームまで
/// 渡すと、リンクを踏んだだけで手元のファイルや別のアプリを起こせてしまう。
/// 本文に書きうるものだけを挙げる。
const OS_SCHEMES: [&str; 5] = ["mailto", "tel", "sms", "facetime", "facetime-audio"];

/// WebView が自分のために使うスキーム。素通しする。
const IN_APP_SCHEMES: [&str; 3] = ["tauri", "asset", "about"];

/// まとめて渡された URL を受け取る道（`open-external.js`）。
///
/// 移動は1つしか持てないので、window.open() が続けて呼ばれた分は1回の移動に
/// まとめて渡ってくる（docs/16-macos-app.md 16.3）。ここへの移動は必ず
/// 取り消すため、この道のページは要らない。
const BATCH_PATH: &str = "/__open-external";

/// 認証のために経由する host。別 origin だがアプリの中で開く。
///
/// デプロイ先を Vercel の Deployment Protection で守っているため、最初の
/// 移動は `https://vercel.com/sso-api?…` へリダイレクトされる
/// （docs/16-macos-app.md 16.1）。ここをブラウザへ渡すと認証 Cookie が
/// ブラウザ側に付いてしまい、WebView は何度起動しても白いままになる。
/// 認証をアプリの中で終わらせるために、この host だけ例外として通す。
const AUTH_HOSTS: [&str; 1] = ["vercel.com"];

/// まとめて渡された URL（`open-external.js`）。その道でなければ None。
///
/// 拾うのは**自分と同じ origin から来たもの**だけ。外部のページがこの道を
/// 騙っても、そこからの移動は別 origin なので拾わない。
///
/// 取り出すだけで、開く・開かないは決めない。1つずつ `route` にかけるのは
/// 呼ぶ側（main.rs）。**判定を通ったものしか開かない**決まりは、まとめて
/// 渡ってきたものでも変わらない（docs/16-macos-app.md 16.5）。
pub fn batched(app: &Url, target: &Url) -> Option<Vec<Url>> {
    if !same_origin(app, target) || target.path() != BATCH_PATH {
        return None;
    }

    Some(
        target
            .query_pairs()
            .filter(|(key, _)| key == "url")
            .filter_map(|(_, value)| Url::parse(&value).ok())
            .collect(),
    )
}

/// `target` をどこで開くか。`app` は Life Record 自身の URL。
pub fn route(app: &Url, target: &Url) -> Route {
    let scheme = target.scheme();

    if scheme == "http" || scheme == "https" {
        if same_origin(app, target) {
            return Route::InApp;
        }
        // 認証の経由先だけは別 origin でも中で開く。盗み見られると認証が
        // そのまま通るので、https で来たものに限る
        if scheme == "https" && is_auth_host(target) {
            return Route::InApp;
        }
        return Route::Os;
    }

    if OS_SCHEMES.contains(&scheme) {
        return Route::Os;
    }

    if IN_APP_SCHEMES.contains(&scheme) {
        return Route::InApp;
    }

    Route::Blocked
}

/// 同じ origin か（スキーム・ホスト・ポートが一致するか）。
///
/// 開発は `http://localhost:3000`、配布物は `https://<デプロイ先>` を指す。
/// どちらの場合も、その1つだけをアプリの中とみなす。
fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}

/// 認証のために通す host か。
///
/// 完全一致でみる。副ドメイン（`foo.vercel.com`）まで許すと、Vercel に
/// 置かれた他人のサイトまでアプリの中で開けてしまう。
fn is_auth_host(url: &Url) -> bool {
    url.host_str()
        .is_some_and(|host| AUTH_HOSTS.contains(&host))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app() -> Url {
        Url::parse("https://life-record.example.com").unwrap()
    }

    fn route_str(target: &str) -> Route {
        route(&app(), &Url::parse(target).unwrap())
    }

    /// 同じ origin はアプリの中で開く
    #[test]
    fn same_origin_opens_in_app() {
        assert_eq!(
            route_str("https://life-record.example.com/today"),
            Route::InApp
        );
        assert_eq!(
            route_str("https://life-record.example.com/items/1?selected=2#a"),
            Route::InApp
        );
        // 既定のポートを書いても同じ origin
        assert_eq!(
            route_str("https://life-record.example.com:443/"),
            Route::InApp
        );
    }

    /// 別の origin は OS へ渡す
    #[test]
    fn other_origin_goes_to_os() {
        assert_eq!(route_str("https://example.com/"), Route::Os);
        assert_eq!(route_str("http://life-record.example.com/"), Route::Os);
        assert_eq!(
            route_str("https://life-record.example.com:8443/"),
            Route::Os
        );
        // ホスト名の後ろに足しただけの紛らわしいもの
        assert_eq!(
            route_str("https://life-record.example.com.evil.test/"),
            Route::Os
        );
    }

    /// 開発時は localhost がアプリの中
    #[test]
    fn dev_url_is_in_app() {
        let dev = Url::parse("http://localhost:3000").unwrap();
        let inside = Url::parse("http://localhost:3000/diary/2026-08-22").unwrap();
        let other = Url::parse("http://localhost:5173/").unwrap();
        assert_eq!(route(&dev, &inside), Route::InApp);
        assert_eq!(route(&dev, &other), Route::Os);
    }

    /// Vercel の認証はアプリの中で通す（別 origin だが例外）
    #[test]
    fn auth_host_opens_in_app() {
        assert_eq!(
            route_str("https://vercel.com/sso-api?url=https%3A%2F%2Fexample.com%2F&nonce=abc"),
            Route::InApp
        );
        assert_eq!(
            route_str("https://vercel.com/login?next=%2Fsso-api"),
            Route::InApp
        );
    }

    /// 認証の例外は vercel.com そのものだけ
    #[test]
    fn auth_host_exception_is_narrow() {
        // 副ドメインは含めない。他人のデプロイ先まで中で開いてしまう
        assert_eq!(route_str("https://other-app.vercel.com/"), Route::Os);
        // ホスト名の後ろに足しただけの紛らわしいもの
        assert_eq!(route_str("https://vercel.com.evil.test/"), Route::Os);
        // http では通さない
        assert_eq!(route_str("http://vercel.com/sso-api"), Route::Os);
    }

    /// メールと電話は OS へ渡す
    #[test]
    fn mailto_and_tel_go_to_os() {
        assert_eq!(route_str("mailto:someone@example.com"), Route::Os);
        assert_eq!(route_str("tel:+81312345678"), Route::Os);
    }

    /// 手元のファイルや見知らぬ独自スキームは開かない
    #[test]
    fn unknown_schemes_are_blocked() {
        assert_eq!(route_str("file:///etc/passwd"), Route::Blocked);
        assert_eq!(route_str("javascript:alert(1)"), Route::Blocked);
        assert_eq!(
            route_str("data:text/html,<script>alert(1)</script>"),
            Route::Blocked
        );
        assert_eq!(route_str("x-unknown-app://run"), Route::Blocked);
    }

    /// WebView 自身のスキームは素通しする
    #[test]
    fn webview_schemes_pass_through() {
        assert_eq!(route_str("about:blank"), Route::InApp);
        assert_eq!(route_str("tauri://localhost/"), Route::InApp);
    }

    fn batched_str(target: &str) -> Option<Vec<Url>> {
        batched(&app(), &Url::parse(target).unwrap())
    }

    /// 自分の origin の、まとめて渡す道。`query` だけを変えて試す
    fn batch_of(query: &str) -> Option<Vec<Url>> {
        batched_str(&format!(
            "https://life-record.example.com/__open-external?{query}"
        ))
    }

    /// まとめて渡された分は、書かれた順に1つずつへ戻す
    #[test]
    fn batch_is_split_into_each_url() {
        assert_eq!(
            batch_of("url=https%3A%2F%2Fa.test%2F1&url=https%3A%2F%2Fb.test%2F2"),
            Some(vec![
                Url::parse("https://a.test/1").unwrap(),
                Url::parse("https://b.test/2").unwrap(),
            ])
        );
    }

    /// 1件でも同じ形で受け取れる
    #[test]
    fn batch_of_one_is_a_batch() {
        assert_eq!(
            batch_of("url=https%3A%2F%2Fa.test%2F"),
            Some(vec![Url::parse("https://a.test/").unwrap()])
        );
    }

    /// ふつうの移動は、まとめて渡されたものではない
    #[test]
    fn ordinary_navigation_is_not_a_batch() {
        assert_eq!(batched_str("https://life-record.example.com/items/1"), None);
        assert_eq!(batched_str("https://example.com/"), None);
    }

    /// 別 origin が道を騙っても拾わない（開くのは自分が渡したものだけ）
    #[test]
    fn batch_from_other_origin_is_ignored() {
        assert_eq!(
            batched_str("https://evil.test/__open-external?url=https%3A%2F%2Fa.test%2F"),
            None
        );
    }

    /// 読めない URL・別の名前の値は落とす（残りはそのまま渡す）
    #[test]
    fn batch_keeps_only_readable_urls() {
        assert_eq!(
            batch_of("url=not%20a%20url&other=https%3A%2F%2Fb.test%2F&url=https%3A%2F%2Fa.test%2F"),
            Some(vec![Url::parse("https://a.test/").unwrap()])
        );
    }

    /// まとめて渡っても、開いてよいかは1つずつ `route` が決める
    #[test]
    fn batched_urls_still_go_through_route() {
        let targets =
            batch_of("url=file%3A%2F%2F%2Fetc%2Fpasswd&url=https%3A%2F%2Fa.test%2F").unwrap();

        let routes: Vec<Route> = targets.iter().map(|url| route(&app(), url)).collect();
        assert_eq!(routes, vec![Route::Blocked, Route::Os]);
    }
}
