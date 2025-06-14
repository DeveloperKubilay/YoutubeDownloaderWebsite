// YouTube Video Downloader Browser Library

// Constants
const audio = [92, 128, 256, 320];
const video = [144, 360, 480, 720, 1080];

/**
 * YouTube video ID'sini URL'den çıkarır
 * @param {string} url - YouTube URL'si
 * @returns {string|null} - Video ID veya null
 */
function getYouTubeVideoId(url) {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|v\/|embed\/|user\/[^\/\n\s]+\/)?(?:watch\?v=|v%3D|embed%2F|video%2F)?|youtu\.be\/|youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/|youtube\.com\/playlist\?list=)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * Hex değerini buffer'a dönüştürür
 * @param {string} hex - Hex değeri
 * @returns {Uint8Array} - Buffer
 */
const hexcode = (hex) => {
    return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
};

/**
 * Şifrelenmiş metni çözer
 * @param {string} enc - Şifrelenmiş metin
 * @returns {Object} - Çözülmüş veri
 */
async function decode(enc) {
    try {
        const secret_key = 'C5D58EF67A7584E4A29F6C35BBC4EB12';
        const data = Uint8Array.from(atob(enc), c => c.charCodeAt(0));
        const iv = data.slice(0, 16);
        const content = data.slice(16);
        const key = hexcode(secret_key);

        // Web Crypto API kullanarak çözme işlemi
        const cryptoKey = await window.crypto.subtle.importKey(
            'raw',
            key,
            { name: 'AES-CBC', length: 128 },
            false,
            ['decrypt']
        );

        const decrypted = await window.crypto.subtle.decrypt(
            { name: 'AES-CBC', iv },
            cryptoKey,
            content
        );

        // ArrayBuffer'ı string'e dönüştür
        const decoder = new TextDecoder();
        return JSON.parse(decoder.decode(decrypted));
    } catch (error) {
        throw new Error(error.message);
    }
}

/**
 * SaveTube üzerinden video indirme URL'ini alır
 * @param {string} link - YouTube video linki
 * @param {number} quality - Kalite değeri
 * @param {string} value - İndirme tipi (audio/video)
 * @returns {Object} - İndirme bilgileri
 */
async function savetube(link, quality, value) {
    try {
        // Rastgele CDN al
        const cdnResponse = await axios.get("https://media.savetube.me/api/random-cdn");
        const cdn = cdnResponse.data.cdn;
        
        // Video bilgilerini al
        const infoResponse = await axios.post('https://' + cdn + '/v2/info', {
            'url': link
        }, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36',
                'Referer': 'https://yt.savetube.me/1kejjj1?id=362796039'
            }
        });
        
        const info = await decode(infoResponse.data.data);
        
        // İndirme bağlantısını al
        const downloadResponse = await axios.post('https://' + cdn + '/download', {
            'downloadType': value,
            'quality': `${quality}`,
            'key': info.key
        }, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36',
                'Referer': 'https://yt.savetube.me/start-download?from=1kejjj1%3Fid%3D362796039'
            }
        });
        
        return {
            status: true,
            quality: `${quality}${value === "audio" ? "kbps" : "p"}`,
            availableQuality: value === "audio" ? audio : video,
            url: downloadResponse.data.data.downloadUrl,
            filename: `${info.title} (${quality}${value === "audio" ? "kbps).mp3" : "p).mp4"}`
        };
    } catch (error) {
        console.error("Converting error:", error);
        return {
            status: false,
            message: "Converting error"
        };
    }
}

/**
 * YouTube video metadata bilgilerini alır
 * @param {string} videoId - Video ID
 * @returns {Promise<Object>} - Video metadatası
 */
async function getVideoMetadata(videoId) {
    try {
        // YouTube oEmbed API'ını kullanarak basit metadata al
        const response = await axios.get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
        
        return {
            title: response.data.title,
            author_name: response.data.author_name,
            thumbnail_url: response.data.thumbnail_url
        };
    } catch (error) {
        console.error("Metadata error:", error);
        return {
            title: "YouTube Video",
            author_name: "Unknown",
            thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
        };
    }
}

/**
 * YouTube videoyu MP3 formatında indir
 * @param {string} link - YouTube video linki
 * @param {number} formats - Ses kalitesi (kbps)
 * @returns {Promise<Object>} - İndirme bilgileri
 */
async function ytmp3(link, formats = 128) {
    const videoId = getYouTubeVideoId(link);
    const format = audio.includes(Number(formats)) ? Number(formats) : 128;
    
    if (!videoId) {
        return {
            status: false,
            message: "Invalid YouTube URL"
        };
    }
    
    try {
        let url = "https://youtube.com/watch?v=" + videoId;
        let metadata = await getVideoMetadata(videoId);
        let response = await savetube(url, format, "audio");
        
        return {
            status: true,
            creator: "@vreden/youtube_scraper",
            metadata: {
                title: metadata.title,
                author: metadata.author_name,
                thumbnail: metadata.thumbnail_url,
                videoId: videoId
            },
            download: response
        };
    } catch (error) {
        console.error(error);
        return {
            status: false,
            message: error.response ? `HTTP Error: ${error.response.status}` : error.message
        };
    }
}

/**
 * YouTube videoyu MP4 formatında indir
 * @param {string} link - YouTube video linki
 * @param {number} formats - Video kalitesi (p)
 * @returns {Promise<Object>} - İndirme bilgileri
 */
async function ytmp4(link, formats = 360) {
    const videoId = getYouTubeVideoId(link);
    const format = video.includes(Number(formats)) ? Number(formats) : 360;
    
    if (!videoId) {
        return {
            status: false,
            message: "Invalid YouTube URL"
        };
    }
    
    try {
        let url = "https://youtube.com/watch?v=" + videoId;
        let metadata = await getVideoMetadata(videoId);
        let response = await savetube(url, format, "video");
        
        return {
            status: true,
            creator: "@vreden/youtube_scraper",
            metadata: {
                title: metadata.title,
                author: metadata.author_name,
                thumbnail: metadata.thumbnail_url,
                videoId: videoId
            },
            download: response
        };
    } catch (error) {
        console.error(error);
        return {
            status: false,
            message: error.response ? `HTTP Error: ${error.response.status}` : error.message
        };
    }
}

// Fonksiyonları global objede dışa aktar
/**
 * YouTube İndirici API'si
 * Bu API, YouTube videolarını MP3 ve MP4 formatında indirmek için kullanılır.
 */

window.YouTubeDownloader = (function() {
    // API endpoint'leri
    const API_BASE_URL = "https://api.example.com/youtube"; // Gerçek bir API URL'si ile değiştirilmeli
    
    // Video ID çıkarma fonksiyonu
    function extractVideoId(url) {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }
    
    // YouTube API'sine istek gönderme
    async function fetchVideoData(videoId) {
        try {
            const response = await axios.get(`${API_BASE_URL}/info?id=${videoId}`);
            return response.data;
        } catch (error) {
            console.error("Video bilgileri alınırken hata oluştu:", error);
            throw new Error("Video bilgileri alınamadı");
        }
    }
    
    return {
        /**
         * YouTube videosunu MP3 formatında indir
         * @param {string} url - YouTube video URL'si
         * @param {string} quality - Ses kalitesi (128, 256, 320)
         * @returns {Promise} İndirme bilgileri
         */
        ytmp3: async function(url, quality) {
            try {
                const videoId = extractVideoId(url);
                
                if (!videoId) {
                    return {
                        status: false,
                        message: "Geçersiz YouTube URL'si"
                    };
                }
                
                // Gerçek API entegrasyonu burada yapılacak
                // Şimdilik örnek veri döndürüyoruz
                
                // API'den video bilgilerini al
                const videoData = await fetchVideoData(videoId);
                
                // Örnek dönüş verisi
                return {
                    status: true,
                    metadata: {
                        title: videoData.title || "Örnek Video Başlığı",
                        author: videoData.author || "Örnek Kanal",
                        thumbnail: videoData.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
                        duration: videoData.duration || "3:45"
                    },
                    download: {
                        url: `${API_BASE_URL}/download?id=${videoId}&format=mp3&quality=${quality}`,
                        quality: `${quality} kbps`,
                        size: videoData.size || "3.2 MB"
                    }
                };
                
            } catch (error) {
                console.error("MP3 indirme hatası:", error);
                return {
                    status: false,
                    message: "MP3 indirme işlemi sırasında bir hata oluştu."
                };
            }
        },
        
        /**
         * YouTube videosunu MP4 formatında indir
         * @param {string} url - YouTube video URL'si
         * @param {string} quality - Video kalitesi (360, 480, 720, 1080)
         * @returns {Promise} İndirme bilgileri
         */
        ytmp4: async function(url, quality) {
            try {
                const videoId = extractVideoId(url);
                
                if (!videoId) {
                    return {
                        status: false,
                        message: "Geçersiz YouTube URL'si"
                    };
                }
                
                // Gerçek API entegrasyonu burada yapılacak
                // Şimdilik örnek veri döndürüyoruz
                
                // API'den video bilgilerini al
                const videoData = await fetchVideoData(videoId);
                
                // Kaliteye göre çözünürlük
                let resolution;
                switch (quality) {
                    case "360": resolution = "360p"; break;
                    case "480": resolution = "480p"; break;
                    case "720": resolution = "720p HD"; break;
                    case "1080": resolution = "1080p Full HD"; break;
                    default: resolution = "360p";
                }
                
                // Örnek dönüş verisi
                return {
                    status: true,
                    metadata: {
                        title: videoData.title || "Örnek Video Başlığı",
                        author: videoData.author || "Örnek Kanal",
                        thumbnail: videoData.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
                        duration: videoData.duration || "3:45"
                    },
                    download: {
                        url: `${API_BASE_URL}/download?id=${videoId}&format=mp4&quality=${quality}`,
                        quality: resolution,
                        size: videoData.size || "24.8 MB"
                    }
                };
                
            } catch (error) {
                console.error("MP4 indirme hatası:", error);
                return {
                    status: false,
                    message: "MP4 indirme işlemi sırasında bir hata oluştu."
                };
            }
        }
    };
})();
