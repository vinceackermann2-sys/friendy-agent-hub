import XCTest

final class BelnaUITests: XCTestCase {
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
