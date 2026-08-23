import AppKit
import Foundation
import Vision

struct TextBlock: Codable {
    let id: String
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct ColorAnnotation: Codable {
    let color: String
    let shape: String
    let confidence: Double
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let regionText: [String]
}

struct OCRResult: Codable {
    let width: Int
    let height: Int
    let blocks: [TextBlock]
    let annotations: [ColorAnnotation]
}

guard CommandLine.arguments.count == 2 else {
    fputs("Usage: vision-ocr.swift <image-path>\n", stderr)
    exit(2)
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard
    let image = NSImage(contentsOf: imageURL),
    let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
    fputs("Unable to decode image\n", stderr)
    exit(3)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage)
try handler.perform([request])

let blocks = (request.results ?? []).compactMap { observation -> TextBlock? in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let box = observation.boundingBox
    return TextBlock(
        id: UUID().uuidString,
        text: candidate.string,
        confidence: candidate.confidence,
        x: box.origin.x,
        y: box.origin.y,
        width: box.size.width,
        height: box.size.height
    )
}

let imageWidth = cgImage.width
let imageHeight = cgImage.height
let bytesPerPixel = 4
let bytesPerRow = imageWidth * bytesPerPixel
var pixels = [UInt8](repeating: 0, count: imageHeight * bytesPerRow)
let colorSpace = CGColorSpaceCreateDeviceRGB()
guard let context = CGContext(
    data: &pixels,
    width: imageWidth,
    height: imageHeight,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    fputs("Unable to create image context\n", stderr)
    exit(4)
}
context.draw(cgImage, in: CGRect(x: 0, y: 0, width: imageWidth, height: imageHeight))

func colorClass(_ offset: Int) -> UInt8 {
    let r = Int(pixels[offset])
    let g = Int(pixels[offset + 1])
    let b = Int(pixels[offset + 2])
    if r >= 170 && r >= g * 13 / 10 && r >= b * 13 / 10 && r - min(g, b) >= 55 {
        return 1
    }
    if g >= 135 && g >= r * 12 / 10 && g >= b * 11 / 10 && g - min(r, b) >= 35 {
        return 2
    }
    return 0
}

var classes = [UInt8](repeating: 0, count: imageWidth * imageHeight)
for y in 0..<imageHeight {
    for x in 0..<imageWidth {
        classes[y * imageWidth + x] = colorClass(y * bytesPerRow + x * bytesPerPixel)
    }
}

func edgeCoverage(
    color: UInt8,
    minX: Int,
    minY: Int,
    maxX: Int,
    maxY: Int,
    horizontal: Bool,
    at coordinate: Int,
    tolerance: Int
) -> Double {
    var hits = 0
    let length = horizontal ? maxX - minX + 1 : maxY - minY + 1
    if length <= 0 { return 0 }
    for position in 0..<length {
        var found = false
        for delta in -tolerance...tolerance {
            let x = horizontal ? minX + position : coordinate + delta
            let y = horizontal ? coordinate + delta : minY + position
            if x >= 0 && x < imageWidth && y >= 0 && y < imageHeight &&
                classes[y * imageWidth + x] == color {
                found = true
                break
            }
        }
        if found { hits += 1 }
    }
    return Double(hits) / Double(length)
}

func recognizeRegion(minX: Int, minY: Int, maxX: Int, maxY: Int) -> [String] {
    let padding = 4
    let cropX = max(0, minX + padding)
    let cropY = max(0, minY + padding)
    let cropWidth = min(imageWidth - cropX, max(1, maxX - minX + 1 - padding * 2))
    let cropHeight = min(imageHeight - cropY, max(1, maxY - minY + 1 - padding * 2))
    guard let crop = cgImage.cropping(to: CGRect(
        x: cropX,
        y: cropY,
        width: cropWidth,
        height: cropHeight
    )) else { return [] }
    let regionRequest = VNRecognizeTextRequest()
    regionRequest.recognitionLevel = .accurate
    regionRequest.usesLanguageCorrection = true
    regionRequest.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
    do {
        try VNImageRequestHandler(cgImage: crop).perform([regionRequest])
        return (regionRequest.results ?? []).compactMap {
            $0.topCandidates(1).first?.string
        }
    } catch {
        return []
    }
}

var visited = [Bool](repeating: false, count: classes.count)
var annotations: [ColorAnnotation] = []
let neighborOffsets = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]

for start in classes.indices where classes[start] != 0 && !visited[start] {
    let targetColor = classes[start]
    var queue = [start]
    visited[start] = true
    var cursor = 0
    var minX = start % imageWidth
    var maxX = minX
    var minY = start / imageWidth
    var maxY = minY
    var count = 0
    while cursor < queue.count {
        let current = queue[cursor]
        cursor += 1
        count += 1
        let x = current % imageWidth
        let y = current / imageWidth
        minX = min(minX, x)
        maxX = max(maxX, x)
        minY = min(minY, y)
        maxY = max(maxY, y)
        for (dx, dy) in neighborOffsets {
            let nx = x + dx
            let ny = y + dy
            if nx < 0 || nx >= imageWidth || ny < 0 || ny >= imageHeight { continue }
            let next = ny * imageWidth + nx
            if !visited[next] && classes[next] == targetColor {
                visited[next] = true
                queue.append(next)
            }
        }
    }
    let componentWidth = maxX - minX + 1
    let componentHeight = maxY - minY + 1
    if count < 80 || componentWidth < 30 || componentHeight < 30 { continue }
    let tolerance = max(2, min(8, min(componentWidth, componentHeight) / 20))
    let coverages = [
        edgeCoverage(color: targetColor, minX: minX, minY: minY, maxX: maxX, maxY: maxY, horizontal: true, at: minY, tolerance: tolerance),
        edgeCoverage(color: targetColor, minX: minX, minY: minY, maxX: maxX, maxY: maxY, horizontal: true, at: maxY, tolerance: tolerance),
        edgeCoverage(color: targetColor, minX: minX, minY: minY, maxX: maxX, maxY: maxY, horizontal: false, at: minX, tolerance: tolerance),
        edgeCoverage(color: targetColor, minX: minX, minY: minY, maxX: maxX, maxY: maxY, horizontal: false, at: maxX, tolerance: tolerance)
    ]
    let averageCoverage = coverages.reduce(0, +) / 4
    if coverages.min()! < 0.35 || averageCoverage < 0.55 { continue }
    annotations.append(ColorAnnotation(
        color: targetColor == 1 ? "red" : "green",
        shape: "rectangle",
        confidence: min(0.99, 0.5 + averageCoverage * 0.5),
        x: Double(minX) / Double(imageWidth),
        y: Double(imageHeight - maxY - 1) / Double(imageHeight),
        width: Double(componentWidth) / Double(imageWidth),
        height: Double(componentHeight) / Double(imageHeight),
        regionText: recognizeRegion(minX: minX, minY: minY, maxX: maxX, maxY: maxY)
    ))
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
let data = try encoder.encode(OCRResult(
    width: imageWidth,
    height: imageHeight,
    blocks: blocks,
    annotations: annotations
))
FileHandle.standardOutput.write(data)
