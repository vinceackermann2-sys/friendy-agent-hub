import XCTest
@testable import Belna

final class BelnaTests: XCTestCase {
    func testBridgeOnlyTrustsExactProductionOrigin() {
        XCTAssertTrue(AppConfiguration.trusted(URL(string: "https://belna.se/app")))
        XCTAssertFalse(AppConfiguration.trusted(URL(string: "https://belna.se.evil.example/app")))
        XCTAssertFalse(AppConfiguration.trusted(URL(string: "http://belna.se/app")))
        XCTAssertFalse(AppConfiguration.trusted(URL(string: "https://belna.se:444/app")))
        XCTAssertFalse(AppConfiguration.trusted(nil))
    }
    @MainActor
    func testDeviceDatesRequireTimeZoneAndAcceptServerFractionalSeconds() {
        XCTAssertNotNil(DeviceServices.date("2026-10-04T12:30:00Z"))
        XCTAssertNotNil(DeviceServices.date("2026-10-04T12:30:00.123Z"))
        XCTAssertNotNil(DeviceServices.date("2026-10-04T12:30:00+02:00"))
        XCTAssertNil(DeviceServices.date("tomorrow"))
        XCTAssertNil(DeviceServices.date("2026-10-04"))
    }
}
