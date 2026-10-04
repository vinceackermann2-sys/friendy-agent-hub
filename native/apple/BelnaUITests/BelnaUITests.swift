import XCTest

final class BelnaUITests: XCTestCase {
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
        XCTAssertTrue(app.webViews.buttons["Continue with Google"].exists)
        XCTAssertFalse(app.staticTexts["Couldn’t open Belna"].exists)

        app.buttons["Apple apps and privacy"].tap()
        XCTAssertTrue(app.staticTexts["Calendar"].waitForExistence(timeout: 5))
        for button in app.buttons.matching(identifier: "Connect").allElementsBoundByIndex {
            XCTAssertFalse(button.isEnabled, "Anonymous WebView must not unlock Apple data")
        }
    }

    func testNativePrivacyGateAndOptionalAppleConnections() {
        let app = XCUIApplication()
        app.launchArguments = ["--reset-consent-for-testing"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Your agent, on your Apple devices"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["I agree — continue to Belna"].exists)
        let consent = XCTAttachment(screenshot: app.screenshot())
        consent.name = "iPhone native consent"; consent.lifetime = .keepAlways; add(consent)
        app.buttons["Apple apps and privacy"].tap()
        XCTAssertTrue(app.staticTexts["Calendar"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Reminders"].exists)
        XCTAssertTrue(app.staticTexts["Contacts"].exists)
        XCTAssertTrue(app.staticTexts["Health"].exists)
        for button in app.buttons.matching(identifier: "Connect").allElementsBoundByIndex { XCTAssertFalse(button.isEnabled, "Apple connection needs account and AI consent") }
        let connections = XCTAttachment(screenshot: app.screenshot())
        connections.name = "Native Apple connections"; connections.lifetime = .keepAlways; add(connections)
    }
}
