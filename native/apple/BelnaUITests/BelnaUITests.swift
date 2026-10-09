import XCTest

final class BelnaUITests: XCTestCase {
    func testReviewAccountScreenshots() throws {
        guard let url = Bundle(for: Self.self).url(forResource: "ReviewerCredentials", withExtension: "json") else {
            throw XCTSkip("Dedicated reviewer credentials are only supplied for release screenshots")
        }
        let credentials = try JSONDecoder().decode(ReviewCredentials.self, from: Data(contentsOf: url))
        let app = XCUIApplication()
        app.launchArguments = ["--reset-consent-for-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["I agree — continue to Belna"].waitForExistence(timeout: 10))
        app.buttons["I agree — continue to Belna"].tap()
        let passwordMode = app.webViews.buttons["Log in with password"]
        let composer = app.webViews.textViews.firstMatch
        if !composer.exists {
            guard passwordMode.waitForExistence(timeout: 60) else {
                let startup = XCTAttachment(screenshot: app.screenshot())
                startup.name = "Reviewer web startup diagnostic"
                startup.lifetime = .keepAlways; add(startup)
                XCTFail("Reviewer password login must load before entering credentials")
                return
            }
            let email = app.webViews.textFields["Enter Email"]
            email.tap(); email.typeText(credentials.email)
            passwordMode.tap()
            let password = app.webViews.secureTextFields["Password (8+ chars)"]
            XCTAssertTrue(password.waitForExistence(timeout: 10))
            password.tap(); password.typeText(credentials.password)
            // WKWebView exposes HTML checkboxes under different XCTest types on iOS.
            let legal = app.webViews.switches
                .matching(NSPredicate(format: "label BEGINSWITH %@", "I agree to the")).firstMatch
            XCTAssertTrue(legal.waitForExistence(timeout: 10))
            if !legal.isHittable {
                let diagnostic = XCTAttachment(screenshot: app.screenshot())
                diagnostic.name = "Reviewer login consent control"
                diagnostic.lifetime = .keepAlways; add(diagnostic)
            }
            // The web label includes links, so target the checkbox at its leading edge.
            legal.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.2)).tap()
            XCTAssertEqual(legal.value as? String, "1")
            app.webViews.buttons["Log in with password"].tap()
        }
        let name = app.webViews.buttons["Alex"]
        if name.waitForExistence(timeout: 15) {
            name.tap()
            let color = app.webViews.buttons["Sky"]
            XCTAssertTrue(color.waitForExistence(timeout: 10)); color.tap()
        }
        XCTAssertTrue(composer.waitForExistence(timeout: 30), "Reviewer must reach the working agent chat")
        let chat = XCTAttachment(screenshot: app.screenshot())
        chat.name = "App Store - Your personal agent"; chat.lifetime = .keepAlways; add(chat)
        XCTAssertFalse(app.navigationBars.firstMatch.exists, "The web app fills the screen without a native top bar")
        // Apple apps opens from the web app: menu → account → Settings → Profiles → Apple apps & privacy.
        // iPad gets the desktop web layout, with the sidebar already showing and no menu button.
        let menu = app.webViews.buttons["Open navigation"]
        if menu.exists && menu.isHittable { menu.tap() }
        let account = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", credentials.email)).firstMatch
        XCTAssertTrue(account.waitForExistence(timeout: 10)); account.tap()
        let settings = app.webViews.buttons.matching(NSPredicate(format: "label ENDSWITH %@", "Settings")).firstMatch
        XCTAssertTrue(settings.waitForExistence(timeout: 10)); settings.tap()
        let profiles = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Profiles")).firstMatch
        XCTAssertTrue(profiles.waitForExistence(timeout: 10)); profiles.tap()
        let appleApps = app.webViews.buttons["Open"]
        XCTAssertTrue(appleApps.waitForExistence(timeout: 10)); appleApps.tap()
        XCTAssertTrue(app.staticTexts["Calendar"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons.matching(identifier: "Connect").firstMatch.isEnabled)
        let connections = XCTAttachment(screenshot: app.screenshot())
        connections.name = "App Store - Optional Apple connections"; connections.lifetime = .keepAlways; add(connections)
    }

    private struct ReviewCredentials: Decodable {
        let email: String
        let password: String
    }

    func testProductionWebViewLoadsNativeAppleSignIn() {
        let app = XCUIApplication()
        app.launchArguments = ["--reset-consent-for-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["I agree — continue to Belna"].waitForExistence(timeout: 10))
        app.buttons["I agree — continue to Belna"].tap()

        // Load the actual published origin through WKWebView. This deliberately
        // leaves sign-in and device permissions untouched; no account data is sent.
        let appleSignIn = app.webViews.buttons["Continue with Apple"]
        let loaded = appleSignIn.waitForExistence(timeout: 60)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Published Belna in iPhone WebView"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        XCTAssertTrue(loaded, "Published login must load and discover the native Apple bridge")
        XCTAssertTrue(app.webViews.buttons["Login with one-time code"].waitForExistence(timeout: 10))
        // Google's OAuth sign-in is intentionally hidden in the embedded app.
        XCTAssertFalse(app.webViews.buttons["Continue with Google"].exists)
        XCTAssertFalse(app.staticTexts["Couldn’t open Belna"].exists)
        // No native bar or Apple apps button above the web app; signed out, Apple apps has no entry point.
        XCTAssertFalse(app.navigationBars.firstMatch.exists)
        XCTAssertFalse(app.buttons["Apple apps and privacy"].exists)
    }

    func testNativePrivacyGate() {
        let app = XCUIApplication()
        app.launchArguments = ["--reset-consent-for-testing"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Your agent, on your Apple devices"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["I agree — continue to Belna"].exists)
        // Before consent the web app and Apple apps cannot be reached at all.
        XCTAssertFalse(app.navigationBars.firstMatch.exists)
        XCTAssertFalse(app.buttons["Apple apps and privacy"].exists)
        XCTAssertFalse(app.webViews.firstMatch.exists)
        let consent = XCTAttachment(screenshot: app.screenshot())
        consent.name = "iPhone native consent"; consent.lifetime = .keepAlways; add(consent)
    }
}
