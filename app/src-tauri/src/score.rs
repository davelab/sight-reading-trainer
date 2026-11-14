//! Reading score files from disk: MusicXML text or compressed `.mxl`.

use std::io::{Cursor, Read};
use std::path::Path;

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedFile {
    pub file_name: String,
    pub musicxml: String,
}

pub fn read_score(path: &Path) -> Result<LoadedFile, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Impossibile leggere {}: {e}", path.display()))?;
    let file_name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let musicxml = if bytes.starts_with(b"PK\x03\x04") { read_mxl(&bytes)? } else { decode_text(bytes)? };
    if !musicxml.contains("<score-partwise") && !musicxml.contains("<score-timewise") {
        return Err(format!("{file_name} non sembra un file MusicXML"));
    }
    Ok(LoadedFile { file_name, musicxml })
}

fn decode_text(bytes: Vec<u8>) -> Result<String, String> {
    // MusicXML is UTF-8 in practice; tolerate a BOM.
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").map(<[u8]>::to_vec).unwrap_or(bytes);
    String::from_utf8(bytes).map_err(|_| "Il file non è in UTF-8 (UTF-16 non ancora supportato)".to_string())
}

/// Unpack a compressed MusicXML (.mxl): the root file is named in META-INF/container.xml.
fn read_mxl(bytes: &[u8]) -> Result<String, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("Archivio .mxl non valido: {e}"))?;
    let root = match read_entry(&mut zip, "META-INF/container.xml") {
        Ok(container) => rootfile_path(&container),
        Err(_) => None,
    }
    .or_else(|| {
        zip.file_names()
            .find(|n| !n.starts_with("META-INF/") && (n.ends_with(".xml") || n.ends_with(".musicxml")))
            .map(str::to_owned)
    })
    .ok_or("Nessuna partitura MusicXML dentro il file .mxl")?;
    read_entry(&mut zip, &root)
}

fn read_entry(zip: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<String, String> {
    let mut entry = zip.by_name(name).map_err(|e| format!("{name}: {e}"))?;
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf).map_err(|e| format!("{name}: {e}"))?;
    decode_text(buf)
}

fn rootfile_path(container_xml: &str) -> Option<String> {
    let doc = roxmltree::Document::parse(container_xml).ok()?;
    doc.descendants()
        .find(|n| n.has_tag_name("rootfile") && n.attribute("full-path").is_some())
        .and_then(|n| n.attribute("full-path"))
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../engine/tests/fixtures/minuet-in-g.musicxml");

    #[test]
    fn reads_plain_musicxml() {
        let f = read_score(Path::new(FIXTURE)).unwrap();
        assert_eq!(f.file_name, "minuet-in-g.musicxml");
        assert!(f.musicxml.contains("<score-partwise"));
    }

    #[test]
    fn reads_mxl_through_container() {
        let xml = std::fs::read(FIXTURE).unwrap();
        let mut buf = Cursor::new(Vec::new());
        {
            let mut zw = zip::ZipWriter::new(&mut buf);
            let opts = zip::write::SimpleFileOptions::default();
            zw.start_file("META-INF/container.xml", opts).unwrap();
            zw.write_all(br#"<container><rootfiles><rootfile full-path="score/m.musicxml"/></rootfiles></container>"#)
                .unwrap();
            zw.start_file("score/m.musicxml", opts).unwrap();
            zw.write_all(&xml).unwrap();
            zw.finish().unwrap();
        }
        let dir = std::env::temp_dir().join(format!("score-studio-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("m.mxl");
        std::fs::write(&path, buf.into_inner()).unwrap();
        let f = read_score(&path).unwrap();
        assert!(f.musicxml.contains("Minuet in G"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn rejects_non_musicxml() {
        let path = std::env::temp_dir().join(format!("not-a-score-{}.xml", std::process::id()));
        std::fs::write(&path, "<html/>").unwrap();
        assert!(read_score(&path).is_err());
        std::fs::remove_file(path).ok();
    }
}
