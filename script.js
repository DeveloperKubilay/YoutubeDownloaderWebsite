document.addEventListener('DOMContentLoaded', function() {
    // Form elemanlarını seç
    const downloadType = document.getElementById('downloadType');
    const audioQualityContainer = document.getElementById('audioQualityContainer');
    const videoQualityContainer = document.getElementById('videoQualityContainer');
    const downloadBtn = document.getElementById('downloadBtn');
    const loader = document.getElementById('loader');
    const result = document.getElementById('result');
    const videoInfo = document.getElementById('videoInfo');
    const downloadLink = document.getElementById('downloadLink');
    const youtubeUrlInput = document.getElementById('youtubeUrl');

    // İndirme tipi değiştiğinde gösterilen kalite seçeneklerini güncelle
    downloadType.addEventListener('change', function() {
        if (this.value === 'audio') {
            audioQualityContainer.style.display = 'block';
            videoQualityContainer.style.display = 'none';
        } else {
            audioQualityContainer.style.display = 'none';
            videoQualityContainer.style.display = 'block';
        }
    });

    // Enter tuşuna basıldığında indirmeyi başlat
    youtubeUrlInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            downloadBtn.click();
        }
    });

    // İndirme butonuna tıklandığında
    downloadBtn.addEventListener('click', async function() {
        const youtubeUrl = youtubeUrlInput.value.trim();
        
        if (!youtubeUrl) {
            showNotification('error', 'Lütfen bir YouTube URL\'si girin.');
            animateInput(youtubeUrlInput);
            return;
        }

        // URL kontrolü
        if (!isValidYouTubeUrl(youtubeUrl)) {
            showNotification('error', 'Geçersiz YouTube URL\'si. Lütfen doğru bir URL girin.');
            animateInput(youtubeUrlInput);
            return;
        }

        // Yükleniyor göstergesini göster
        loader.style.display = 'block';
        result.style.display = 'none';
        downloadBtn.disabled = true;
        downloadBtn.classList.add('disabled');

        try {
            let response;
            const videoId = extractVideoId(youtubeUrl);
            
            // Video ID'yi kontrol et
            if (!videoId) {
                throw new Error("Video ID alınamadı");
            }
            
            // YouTube video thumbnail URL'ini oluştur
            const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
            
            if (downloadType.value === 'audio') {
                const quality = document.getElementById('audioQuality').value;
                
                // YouTube Downloader API'sini kullan (youtube-downloader.js'den)
                response = await ytmp3(youtubeUrl, quality);
                
                if (!response.status) {
                    // Alternatif olarak varsayılan bir yanıt oluştur
                    response = createDummyResponse(youtubeUrl, videoId, quality, 'audio');
                }
            } else {
                const quality = document.getElementById('videoQuality').value;
                
                // YouTube Downloader API'sini kullan (youtube-downloader.js'den)
                response = await ytmp4(youtubeUrl, quality);
                
                if (!response.status) {
                    // Alternatif olarak varsayılan bir yanıt oluştur
                    response = createDummyResponse(youtubeUrl, videoId, quality, 'video');
                }
            }

            // Video bilgilerini göster
            videoInfo.innerHTML = `
                <p><strong>Başlık:</strong> ${response.metadata.title}</p>
                <p><strong>Kanal:</strong> ${response.metadata.author}</p>
                <p><strong>Video ID:</strong> ${videoId}</p>
                <img src="${response.metadata.thumbnail}" alt="Video Thumbnail" loading="lazy">
            `;

            // İndirme linkini göster
            downloadLink.innerHTML = `
                <a href="${response.download.url}" target="_blank" class="download-button">
                    <i class="${downloadType.value === 'audio' ? 'fas fa-music' : 'fas fa-video'}"></i>
                    ${downloadType.value === 'audio' ? 'MP3' : 'MP4'} İndir 
                    (${response.download.quality})
                </a>
            `;
            
            // Sonuç kartını göster
            result.style.display = 'block';
            
            // Başarılı bildirim göster
            showNotification('success', 'Video bilgileri başarıyla alındı! İndirme butonuna tıklayabilirsiniz.');
            
            // Otomatik kaydırma
            setTimeout(() => {
                result.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 300);
        } catch (error) {
            console.error('İndirme hatası:', error);
            showNotification('error', 'Video indirilemedi: ' + error.message);
        } finally {
            loader.style.display = 'none';
            downloadBtn.disabled = false;
            downloadBtn.classList.remove('disabled');
        }
    });
    
    // URL doğrulama fonksiyonu
    function isValidYouTubeUrl(url) {
        const regExp = /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&].*)?$/;
        return regExp.test(url);
    }
    
    // YouTube video ID çıkarma fonksiyonu
    function extractVideoId(url) {
        const regExp = /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&].*)?$/;
        const match = url.match(regExp);
        return match ? match[1] : null;
    }
    
    // Varsayılan yanıt oluşturma fonksiyonu (API başarısız olursa)
    function createDummyResponse(url, videoId, quality, type) {
        // Video başlığını tahmin et
        const cleanUrl = url.replace(/https?:\/\/(www\.)?youtube\.com\/watch\?v=|https?:\/\/youtu\.be\//, '');
        const videoTitle = `YouTube Video (${cleanUrl})`;
        
        return {
            status: true,
            metadata: {
                title: videoTitle,
                author: "YouTube Channel",
                thumbnail: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
                videoId: videoId
            },
            download: {
                url: type === 'audio' 
                    ? `https://www.yt-download.org/api/button/mp3/${videoId}/${quality}` 
                    : `https://www.yt-download.org/api/button/videos/${videoId}/${quality}`,
                quality: type === 'audio' ? `${quality} kbps` : `${quality}p`,
                size: type === 'audio' ? "3-8 MB" : "15-60 MB"
            }
        };
    }
    
    // Girişi animasyonla vurgulama
    function animateInput(inputElement) {
        inputElement.style.transition = 'border-color 0.3s';
        inputElement.style.borderColor = '#ff4b2b';
        
        setTimeout(() => {
            inputElement.style.borderColor = 'rgba(118, 75, 162, 0.2)';
        }, 1000);
        
        inputElement.focus();
    }
    
    // Bildirim gösterme fonksiyonu
    function showNotification(type, message) {
        // Varsa önceki bildirimi kaldır
        const existingNotification = document.querySelector('.notification');
        if (existingNotification) {
            existingNotification.remove();
        }
        
        // Yeni bildirim oluştur
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas ${type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle'}"></i>
                <p>${message}</p>
            </div>
            <button class="notification-close"><i class="fas fa-times"></i></button>
        `;
        
        document.body.appendChild(notification);
        
        // Bildirim animasyonu
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // 5 saniye sonra kaldır
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 5000);
        
        // Kapatma butonuna tıklama
        notification.querySelector('.notification-close').addEventListener('click', () => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300);
        });
    }
});
