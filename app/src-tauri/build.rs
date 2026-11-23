fn main() {
    // Target triple, to find the sidecar named `engine-<triple>` in development.
    println!("cargo:rustc-env=TARGET_TRIPLE={}", std::env::var("TARGET").unwrap_or_default());
    tauri_build::build()
}
