//! Cookie 文件加密。
//!
//! Windows 上使用 DPAPI（当前用户范围）加密，文件离开本机或换用户都无法解密；
//! 旧版本的明文 cookies.json 仍可读取并会在首次启动时迁移。

const MAGIC: &[u8] = b"BTCOOK1";

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;

    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };

    const ENTROPY: &[u8] = b"Bilibili-Tauri/cookies/v1";

    fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        }
    }

    unsafe fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        LocalFree(out.pbData as *mut c_void);
        bytes
    }

    pub fn seal(data: &[u8]) -> Result<Vec<u8>, String> {
        let input = blob(data);
        let entropy = blob(ENTROPY);
        let mut output = CRYPT_INTEGER_BLOB::default();
        let ok = unsafe {
            CryptProtectData(
                &input,
                std::ptr::null(),
                &entropy,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(unsafe { take(output) })
    }

    pub fn open(data: &[u8]) -> Result<Vec<u8>, String> {
        let input = blob(data);
        let entropy = blob(ENTROPY);
        let mut output = CRYPT_INTEGER_BLOB::default();
        let ok = unsafe {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                &entropy,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(unsafe { take(output) })
    }
}

pub fn seal(data: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        let protected = platform::seal(data)?;
        let mut out = Vec::with_capacity(MAGIC.len() + protected.len());
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&protected);
        Ok(out)
    }
    #[cfg(not(windows))]
    {
        Ok(data.to_vec())
    }
}

/// 解密文件内容；没有魔数的旧文件按明文 JSON 处理。
pub fn open(data: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        if let Some(rest) = data.strip_prefix(MAGIC) {
            return platform::open(rest);
        }
        Ok(data.to_vec())
    }
    #[cfg(not(windows))]
    {
        Ok(data.to_vec())
    }
}
