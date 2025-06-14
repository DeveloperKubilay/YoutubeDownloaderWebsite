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

    // İndirme butonuna tıklandığında
    downloadBtn.addEventListener('click', async function() {
        const youtubeUrl = document.getElementById('youtubeUrl').value.trim();
        if (!youtubeUrl) {
            showNotification('error', 'Lütfen bir YouTube URL\'si girin.');
            return;
        }

        // URL kontrolü
        if (!isValidYouTubeUrl(youtubeUrl)) {
            showNotification('error', 'Geçersiz YouTube URL\'si. Lütfen doğru bir URL girin.');
            return;
        }

        // Yükleniyor göstergesini göster
        loader.style.display = 'block';
        result.style.display = 'none';
        downloadBtn.disabled = true;
        downloadBtn.classList.add('disabled');

        try {
            let response;
            if (downloadType.value === 'audio') {
                const quality = document.getElementById('audioQuality').value;
                response = await window.YouTubeDownloader.ytmp3(youtubeUrl, quality);
            } else {
                const quality = document.getElementById('videoQuality').value;
                response = await window.YouTubeDownloader.ytmp4(youtubeUrl, quality);
            }

            if (response.status) {
                // Video bilgilerini göster
                videoInfo.innerHTML = `
                    <p><strong>Başlık:</strong> ${response.metadata.title}</p>
                    <p><strong>Kanal:</strong> ${response.metadata.author}</p>
                    <img src="${response.metadata.thumbnail}" alt="Thumbnail">
                `;

                // İndirme linkini göster
                downloadLink.innerHTML = `
                    <a href="${response.download.url}" target="_blank" class="download-button">
                        <i class="fas fa-cloud-download-alt"></i>
                        ${downloadType.value === 'audio' ? 'MP3' : 'MP4'} İndir 
                        (${response.download.quality})
                    </a>
                `;
                
                result.style.display = 'block';
                
                // Başarılı bildirim göster
                showNotification('success', 'Video bilgileri başarıyla alındı! İndirme butonuna tıklayabilirsiniz.');
                
                // Otomatik kaydırma
                result.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                showNotification('error', `Hata: ${response.message}`);
            }
        } catch (error) {
            console.error('İndirme hatası:', error);
            showNotification('error', 'Video indirilemedi. Lütfen tekrar deneyin.');
        } finally {
            loader.style.display = 'none';
            downloadBtn.disabled = false;
            downloadBtn.classList.remove('disabled');
        }
    });
    
    // URL doğrulama fonksiyonu
    function isValidYouTubeUrl(url) {
        const pattern = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})$/;
        return pattern.test(url);
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
    
    // Destek için stil ekle
    const notificationStyle = document.createElement('style');
    notificationStyle.textContent = `
        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 8px;
            background: white;
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 300px;
            max-width: calc(100vw - 40px);
            transform: translateX(120%);
            transition: transform 0.3s ease;
            z-index: 1000;
        }
        .notification.show {
            transform: translateX(0);
        }
        .notification.error {
            border-left: 4px solid #ff4b2b;
        }
        .notification.success {
            border-left: 4px solid #00b09b;
        }
        .notification-content {
            display: flex;
            align-items: center;
        }
        .notification-content i {
            margin-right: 10px;
            font-size: 18px;
        }
        .notification.error i {
            color: #ff4b2b;
        }
        .notification.success i {
            color: #00b09b;
        }
        .notification-close {
            background: transparent;
            border: none;
            cursor: pointer;
            font-size: 16px;
            color: #777;
        }
        .disabled {
            opacity: 0.7;
            cursor: not-allowed !important;
        }
    `;
    document.head.appendChild(notificationStyle);
});
