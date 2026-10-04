import Foundation
import EventKit
import Contacts
import HealthKit

enum DeviceError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}
enum AppleScope: String, CaseIterable, Identifiable {
    case calendar, reminders, contacts, health
    var id: String { rawValue }
    var title: String { switch self { case .calendar: "Calendar"; case .reminders: "Reminders"; case .contacts: "Contacts"; case .health: "Health" } }
    var icon: String { switch self { case .calendar: "calendar"; case .reminders: "checklist"; case .contacts: "person.crop.circle"; case .health: "heart" } }
}

@MainActor
final class DeviceServices {
    let events = EKEventStore()
    let contacts = CNContactStore()
    let health = HKHealthStore()
    var accountId = ""
    private var defaults: UserDefaults { .standard }
    private func key(_ scope: AppleScope) -> String { "belna.apple.\(accountId).\(scope.rawValue).v1" }
    func available(_ scope: AppleScope) -> Bool { scope != .health || HKHealthStore.isHealthDataAvailable() }
    func connected(_ scope: AppleScope) -> Bool {
        guard !accountId.isEmpty, available(scope), defaults.bool(forKey: key(scope)) else { return false }
        switch scope {
        case .calendar: return EKEventStore.authorizationStatus(for: .event) == .fullAccess
        case .reminders: return EKEventStore.authorizationStatus(for: .reminder) == .fullAccess
        case .contacts:
            let status = CNContactStore.authorizationStatus(for: .contacts)
            if #available(iOS 18, *) { return status == .authorized || status == .limited }
            return status == .authorized
        case .health:
            // HealthKit intentionally does not reveal whether read access was
            // granted. A connected scope never claims every metric is readable.
            return true
        }
    }
    func capabilities() -> [String: Bool] { Dictionary(uniqueKeysWithValues: AppleScope.allCases.map { ($0.rawValue, connected($0)) }) }
    func disconnect(_ scope: AppleScope) { if !accountId.isEmpty { defaults.removeObject(forKey: key(scope)) } }
    func disconnectAll() { AppleScope.allCases.forEach(disconnect) }
    func statusText(_ scope: AppleScope) -> String {
        if !available(scope) { return "HealthKit is unavailable on this device. Use your iPhone or a supported iPad." }
        if accountId.isEmpty { return "Sign in to Belna before connecting." }
        if connected(scope) {
            if scope == .health { return "Enabled for wellness summaries. Read permissions remain private; empty results do not confirm permission. Review every summary before sharing." }
            if scope == .contacts, #available(iOS 18, *), CNContactStore.authorizationStatus(for: .contacts) == .limited { return "Only the contacts you selected are available." }
            return "Connected. Your agent can use this device while Belna is open. Changes require approval."
        }
        return "Optional. Apple asks for permission when you connect. Manage denied or revoked permissions in device Settings."
    }
    func connect(_ scope: AppleScope) async throws {
        guard !accountId.isEmpty else { throw DeviceError.message("Sign in to Belna first.") }
        guard available(scope) else { throw DeviceError.message("Health is unavailable on this device.") }
        let account = accountId
        let granted: Bool
        switch scope {
        case .calendar: granted = try await events.requestFullAccessToEvents()
        case .reminders: granted = try await events.requestFullAccessToReminders()
        case .contacts: granted = try await contacts.requestAccess(for: .contacts)
        case .health:
            let types = healthTypes()
            try await health.requestAuthorization(toShare: [], read: types)
            granted = true // Completed prompt; not a claim of read authorization.
        }
        guard accountId == account else { throw DeviceError.message("Account changed; connect again after signing in.") }
        guard granted else { throw DeviceError.message("Permission was not granted. You can change it in device Settings.") }
        defaults.set(true, forKey: key(scope))
    }
    static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
    private func iso(_ date: Date) -> String { ISO8601DateFormatter().string(from: date) }
    private func text(_ args: [String: Any], _ name: String, required: Bool = false, max: Int = 2000) throws -> String {
        let value = args[name] as? String ?? ""
        if value.count > max || (required && value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) { throw DeviceError.message("Invalid \(name).") }
        return value
    }
    private func dateArg(_ args: [String: Any], _ name: String) throws -> Date {
        guard let value = args[name] as? String, let date = Self.date(value) else { throw DeviceError.message("\(name) needs an ISO 8601 date with a time zone.") }
        return date
    }
    private func scope(_ action: String) throws -> AppleScope {
        let valid = ["calendar.list","calendar.create","calendar.update","calendar.delete","reminders.list","reminders.create","reminders.update","reminders.complete","reminders.delete","contacts.search","contacts.create","contacts.update","contacts.delete","health.summary"]
        guard valid.contains(action), let scope = AppleScope(rawValue: String(action.split(separator: ".")[0])) else { throw DeviceError.message("Unsupported Apple action.") }
        guard connected(scope) else { throw DeviceError.message("Connect \(scope.title) in Apple apps first; permission may have been revoked.") }
        return scope
    }
    private func event(_ args: [String: Any]) throws -> EKEvent {
        let id = try text(args, "id", required: true, max: 500)
        guard let event = events.event(withIdentifier: id) else { throw DeviceError.message("Calendar event no longer exists. Read Calendar again.") }
        guard !event.hasRecurrenceRules else { throw DeviceError.message("Edit recurring events in Calendar to choose which occurrences change.") }
        guard event.calendar.allowsContentModifications else { throw DeviceError.message("This calendar is read-only.") }
        return event
    }
    private func reminder(_ args: [String: Any]) throws -> EKReminder {
        let id = try text(args, "id", required: true, max: 500)
        guard let item = events.calendarItem(withIdentifier: id) as? EKReminder else { throw DeviceError.message("Reminder no longer exists. Read Reminders again.") }
        guard item.calendar.allowsContentModifications, !item.hasRecurrenceRules else { throw DeviceError.message("Edit this recurring or read-only reminder in Reminders.") }
        return item
    }
    private func contact(_ args: [String: Any]) throws -> CNMutableContact {
        let id = try text(args, "id", required: true, max: 500)
        return try contacts.unifiedContact(withIdentifier: id, keysToFetch: contactKeys()).mutableCopy() as! CNMutableContact
    }
    private func contactKeys() -> [CNKeyDescriptor] { [CNContactIdentifierKey, CNContactGivenNameKey, CNContactFamilyNameKey, CNContactEmailAddressesKey, CNContactPhoneNumbersKey].map { $0 as CNKeyDescriptor } }
    func describe(_ action: String, args: [String: Any]) throws -> String {
        _ = try scope(action)
        var target = ""
        if action.hasPrefix("calendar."), action != "calendar.create" { let item = try event(args); target = "Event: \(item.title ?? "")\nStarts: \(iso(item.startDate))\nCalendar: \(item.calendar.title)\n" }
        if action.hasPrefix("reminders."), action != "reminders.create" { let item = try reminder(args); target = "Reminder: \(item.title ?? "")\nList: \(item.calendar.title)\n" }
        if action.hasPrefix("contacts."), action != "contacts.create" { let item = try contact(args); target = "Contact: \(item.givenName) \(item.familyName)\n" }
        let data = try JSONSerialization.data(withJSONObject: args, options: [.prettyPrinted, .sortedKeys])
        return target + String(decoding: data, as: UTF8.self)
    }
    private func calendar(_ args: [String: Any], for type: EKEntityType) throws -> EKCalendar {
        let id = try text(args, "calendarId", max: 500)
        let calendar = id.isEmpty ? (type == .event ? events.defaultCalendarForNewEvents : events.defaultCalendarForNewReminders()) : events.calendar(withIdentifier: id)
        guard let calendar, calendar.allowedEntityTypes.contains(type == .event ? .event : .reminder), calendar.allowsContentModifications else { throw DeviceError.message("Choose an available writable calendar or reminder list.") }
        return calendar
    }
    func execute(_ action: String, args: [String: Any]) async throws -> [String: Any] {
        _ = try scope(action)
        let limit = min(50, max(1, args["limit"] as? Int ?? 30))
        let offset = min(1000, max(0, args["offset"] as? Int ?? 0))
        switch action {
        case "calendar.list":
            let start = try dateArg(args, "start"), end = try dateArg(args, "end")
            guard end > start, end.timeIntervalSince(start) <= 31 * 86400 else { throw DeviceError.message("Read at most 31 days of Calendar at a time.") }
            let items = events.events(matching: events.predicateForEvents(withStart: start, end: end, calendars: nil)).sorted { $0.startDate < $1.startDate }
            let page = Array(items.dropFirst(offset).prefix(limit))
            return ["events": page.map { ["id": $0.eventIdentifier ?? "", "title": $0.title ?? "", "start": iso($0.startDate), "end": iso($0.endDate), "allDay": $0.isAllDay, "calendarId": $0.calendar.calendarIdentifier, "calendar": $0.calendar.title, "location": $0.location ?? ""] as [String: Any] }, "calendars": events.calendars(for: .event).map { ["id": $0.calendarIdentifier, "title": $0.title, "writable": $0.allowsContentModifications] as [String: Any] }, "hasMore": offset + page.count < items.count, "nextOffset": offset + page.count]
        case "calendar.create", "calendar.update":
            let item = action == "calendar.create" ? EKEvent(eventStore: events) : try event(args)
            if action == "calendar.create" { item.calendar = try calendar(args, for: .event) }
            if args["title"] != nil || action == "calendar.create" { item.title = try text(args,"title",required:true,max:300) }
            if args["start"] != nil || action == "calendar.create" { item.startDate = try dateArg(args,"start") }
            if args["end"] != nil || action == "calendar.create" { item.endDate = try dateArg(args,"end") }
            guard item.endDate > item.startDate else { throw DeviceError.message("The event must end after it starts.") }
            if args["notes"] != nil { item.notes = try text(args,"notes") }
            if args["location"] != nil { item.location = try text(args,"location",max:300) }
            try events.save(item, span: .thisEvent, commit: true)
            return ["id": item.eventIdentifier ?? "", "title": item.title ?? "", "saved": true]
        case "calendar.delete":
            let item = try event(args); try events.remove(item, span: .thisEvent, commit: true); return ["deleted": true]
        case "reminders.list":
            let predicate = events.predicateForReminders(in: nil)
            let items: [EKReminder] = await withCheckedContinuation { continuation in events.fetchReminders(matching: predicate) { continuation.resume(returning: $0 ?? []) } }
            let filtered = items.filter { args["completed"] == nil || $0.isCompleted == (args["completed"] as? Bool ?? false) }.sorted { ($0.title ?? "") < ($1.title ?? "") }
            let page = Array(filtered.dropFirst(offset).prefix(limit))
            return ["reminders": page.map { item in ["id": item.calendarItemIdentifier, "title": item.title ?? "", "completed": item.isCompleted, "list": item.calendar.title, "due": item.dueDateComponents.flatMap { Calendar.current.date(from: $0) }.map(iso) ?? ""] as [String: Any] }, "lists": events.calendars(for: .reminder).map { ["id": $0.calendarIdentifier, "title": $0.title, "writable": $0.allowsContentModifications] as [String: Any] }, "hasMore": offset + page.count < filtered.count, "nextOffset": offset + page.count]
        case "reminders.create", "reminders.update", "reminders.complete":
            let item = action == "reminders.create" ? EKReminder(eventStore: events) : try reminder(args)
            if action == "reminders.create" { item.calendar = try calendar(args, for: .reminder) }
            if args["title"] != nil || action == "reminders.create" { item.title = try text(args,"title",required:true,max:300) }
            if args["notes"] != nil { item.notes = try text(args,"notes") }
            if args["due"] != nil { let date = try dateArg(args,"due"); item.dueDateComponents = Calendar.current.dateComponents([.year,.month,.day,.hour,.minute,.timeZone], from: date) }
            if action == "reminders.complete" { item.isCompleted = args["completed"] as? Bool ?? true }
            else if let completed = args["completed"] as? Bool { item.isCompleted = completed }
            try events.save(item, commit: true); return ["id": item.calendarItemIdentifier, "saved": true, "completed": item.isCompleted]
        case "reminders.delete":
            try events.remove(try reminder(args), commit: true); return ["deleted": true]
        case "contacts.search":
            let query = try text(args,"query",required:true,max:100)
            let items = try contacts.unifiedContacts(matching: CNContact.predicateForContacts(matchingName: query), keysToFetch: contactKeys())
            let page = Array(items.dropFirst(offset).prefix(limit))
            return ["contacts": page.map { ["id": $0.identifier, "givenName": $0.givenName, "familyName": $0.familyName, "emails": $0.emailAddresses.prefix(5).map { $0.value as String }, "phones": $0.phoneNumbers.prefix(5).map { $0.value.stringValue }] as [String: Any] }, "hasMore": offset + page.count < items.count, "nextOffset": offset + page.count]
        case "contacts.create", "contacts.update", "contacts.delete":
            let item = action == "contacts.create" ? CNMutableContact() : try contact(args)
            let request = CNSaveRequest()
            if action == "contacts.delete" { request.delete(item) }
            else {
                if args["givenName"] != nil || action == "contacts.create" { item.givenName = try text(args,"givenName",required:true,max:100) }
                if args["familyName"] != nil { item.familyName = try text(args,"familyName",max:100) }
                // Replace only the field explicitly requested; preserve the rest.
                if args["email"] != nil { let email = try text(args,"email",max:200); item.emailAddresses = email.isEmpty ? [] : [CNLabeledValue(label: CNLabelHome, value: email as NSString)] }
                if args["phone"] != nil { let phone = try text(args,"phone",max:80); item.phoneNumbers = phone.isEmpty ? [] : [CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: phone))] }
                if action == "contacts.create" { request.add(item, toContainerWithIdentifier: nil) } else { request.update(item) }
            }
            try contacts.execute(request); return ["id": item.identifier, "saved": action != "contacts.delete", "deleted": action == "contacts.delete"]
        case "health.summary":
            guard args["purpose"] as? String == "wellness" else { throw DeviceError.message("Health summaries are only for your own fitness and wellness.") }
            return try await healthSummary(days: min(7,max(1,args["days"] as? Int ?? 1)))
        default: throw DeviceError.message("Unsupported action.")
        }
    }
    private func healthTypes() -> Set<HKObjectType> {
        var types = Set<HKObjectType>()
        for id in [HKQuantityTypeIdentifier.stepCount, .distanceWalkingRunning, .appleExerciseTime] { if let type = HKObjectType.quantityType(forIdentifier: id) { types.insert(type) } }
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(sleep) }
        return types
    }
    private func quantity(_ id: HKQuantityTypeIdentifier, unit: HKUnit, start: Date, end: Date) async throws -> Double? {
        guard let type = HKObjectType.quantityType(forIdentifier: id) else { return nil }
        return try await withCheckedThrowingContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [.strictStartDate, .strictEndDate])
            let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, statistics, error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: statistics?.sumQuantity()?.doubleValue(for: unit)) }
            }
            health.execute(query)
        }
    }
    private func healthSummary(days: Int) async throws -> [String: Any] {
        let end = Date(), start = Calendar.current.date(byAdding: .day, value: -days, to: end)!
        var result: [String: Any] = ["start": iso(start), "end": iso(end), "purpose": "wellness", "note": "An unavailable metric can mean no records or no read permission. This is a wellness summary, not medical advice."]
        for (name,id,unit) in [("steps",HKQuantityTypeIdentifier.stepCount,HKUnit.count()), ("distanceMeters",.distanceWalkingRunning,.meter()), ("exerciseMinutes",.appleExerciseTime,.minute())] {
            // Denial or missing records must never turn into a fabricated zero.
            do { if let value = try await quantity(id,unit:unit,start:start,end:end) { result[name] = value } else { result[name] = NSNull() } }
            catch { result[name] = NSNull() }
        }
        if let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            let samples: [HKCategorySample] = try await withCheckedThrowingContinuation { continuation in
                let query = HKSampleQuery(sampleType: type, predicate: HKQuery.predicateForSamples(withStart: start,end:end,options: []), limit: 5000, sortDescriptors: nil) { _, samples, error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: samples as? [HKCategorySample] ?? []) }
                }
                health.execute(query)
            }
            // Merge overlapping records (e.g. multiple watches/sources), so sleep
            // is never double counted; omit inBed/awake records.
            let asleep = Set([HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue, HKCategoryValueSleepAnalysis.asleepCore.rawValue, HKCategoryValueSleepAnalysis.asleepDeep.rawValue, HKCategoryValueSleepAnalysis.asleepREM.rawValue])
            let ranges = samples.filter { asleep.contains($0.value) }.map { (max(start,$0.startDate),min(end,$0.endDate)) }.filter { $0.1 > $0.0 }.sorted { $0.0 < $1.0 }
            var merged = [(Date,Date)]()
            for range in ranges {
                if let last = merged.last, range.0 <= last.1 { merged[merged.count-1].1 = max(last.1,range.1) }
                else { merged.append(range) }
            }
            result["sleepHours"] = merged.isEmpty ? NSNull() : merged.reduce(0.0) { $0 + $1.1.timeIntervalSince($1.0)/3600 } as Any
            result["sleepRecordsMayBeTruncated"] = samples.count == 5000
        }
        return result
    }
}
