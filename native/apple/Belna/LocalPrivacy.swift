import Foundation

enum LocalPrivacy {
    // WebKit can cache chat text containing a shared Health summary. Keep all
    // app-local state out of iCloud/device backups, including WebKit storage.
    static func excludeFromBackup(_ directory: URL) throws {
        var url = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
    }

    static func protectAppStorage() throws {
        let directories: [FileManager.SearchPathDirectory] = [.libraryDirectory, .documentDirectory]
        for directory in directories {
            let url = try FileManager.default.url(for: directory, in: .userDomainMask, appropriateFor: nil, create: true)
            try excludeFromBackup(url)
        }
    }
}
