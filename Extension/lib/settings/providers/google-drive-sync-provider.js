/**
 * This file is part of Adguard Browser Extension (https://github.com/AdguardTeam/AdguardBrowserExtension).
 *
 * Adguard Browser Extension is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Adguard Browser Extension is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Adguard Browser Extension.  If not, see <http://www.gnu.org/licenses/>.
 */

/* global Promise */

/**
 * Google Drive sync provider
 */
(function (api, adguard) {

    'use strict';

    var CLIENT_ID = '379033535124-eegqqpu1d232b5u1r8dkeu9h2ukkhejd.apps.googleusercontent.com';
    var PROVIDER_NAME = 'GOOGLE_DRIVE';
    var TOKEN_STORAGE_PROP = 'google-drive-auth-token';

    var accessToken;

    /**
     * Keeps local folder structure
     */
    var googleDriveFolderState = {
        startPageToken: null,
        files: null
    };

    var GoogleDriveClient = (function () {

        var securityToken;

        function checkInvalidToken(status) {
            if (status === 401 || status === 403) {
                revokeToken();
            }
        }

        function revokeToken() {
            if (accessToken) {
                makeRequest('GET', 'https://accounts.google.com/o/oauth2/revoke?token=' + accessToken);
                adguard.localStorage.removeItem(TOKEN_STORAGE_PROP);
                accessToken = null;
            }
        }

        function makeRequest(method, url, data, headers) {

            return new Promise(function (resolve, reject) {

                data = data || null;
                headers = headers || {};

                var xhr = new XMLHttpRequest();
                xhr.open(method, url, true);

                // Include common headers (auth and version) and add rest.
                xhr.setRequestHeader('Authorization', 'Bearer ' + accessToken);
                if (headers) {
                    for (var key in headers) {
                        if (headers.hasOwnProperty(key)) {
                            xhr.setRequestHeader(key, headers[key]);
                        }
                    }
                }

                xhr.onload = function () {
                    var status = xhr.status;
                    if (status === 200) {
                        resolve(JSON.parse(xhr.responseText));
                    } else {
                        checkInvalidToken(status);
                        reject({status: status, error: new Error(xhr.statusText)});
                    }
                };

                xhr.onerror = function () {
                    checkInvalidToken(xhr.status);
                    reject({status: xhr.status, error: new Error(xhr.statusText)});
                };
                xhr.send(data ? data : null);
            });
        }

        /**
         * Uploads file to Google Drive Storage. We create file in app data folder
         *
         * https://developers.google.com/drive/v3/reference/files/create
         * https://developers.google.com/drive/v3/reference/files/update
         *
         * @param fileId File identifier (maybe empty)
         * @param name File name
         * @param data File data
         */
        var uploadFile = function (fileId, name, data) {

            var boundary = '-------314159265358979323846';
            var delimiter = "\r\n--" + boundary + "\r\n";
            var endDelimiter = "\r\n--" + boundary + "--";

            var url = 'https://www.googleapis.com/upload/drive/v3/files';
            var method = 'POST';
            if (fileId) {
                // Updates file
                url += '/' + fileId;
                method = 'PATCH';
            }
            url += '?uploadType=multipart';

            var metadata = {};
            if (!fileId) {
                // Setup metadata
                metadata = {
                    name: name,
                    parents: ['appDataFolder']
                };
            }

            var headers = {
                'Content-Type': 'multipart/related; boundary=' + boundary
            };

            var requestBody = delimiter +
                'Content-Type: application/json\r\n\r\n' +
                JSON.stringify(metadata) +
                delimiter +
                'Content-Type: application/json\r\n' +
                '\r\n' +
                JSON.stringify(data) +
                endDelimiter;

            return makeRequest(method, url, requestBody, headers);
        };

        /**
         * Loads file content by identifier
         *
         * https://developers.google.com/drive/v3/reference/files/get
         *
         * @param fileId File identifier
         */
        var downloadFile = function (fileId) {
            var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media';
            return makeRequest('GET', url);
        };

        /**
         * https://developers.google.com/drive/v3/reference/changes/getStartPageToken
         */
        var getStartPageToken = function () {
            var url = 'https://www.googleapis.com/drive/v3/changes/startPageToken';
            return makeRequest('GET', url)
                .then(function (response) {
                    return response.startPageToken;
                });
        };

        /**
         * https://developers.google.com/drive/v3/reference/changes/list
         * https://developers.google.com/drive/v3/reference/changes#resource
         */
        var listChanges = function (token) {
            var query = 'pageToken=' + encodeURIComponent(token) + '&spaces=appDataFolder';
            var url = 'https://www.googleapis.com/drive/v3/changes?' + query;
            return makeRequest('GET', url);
        };

        /**
         * https://developers.google.com/drive/v3/reference/files/list
         */
        var listFiles = function () {
            return makeRequest('GET', 'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder');
        };

        /**
         * https://developers.google.com/drive/v3/reference/files/delete
         * @param fileId
         * @returns {*}
         */
        var deleteFile = function (fileId) {
            return makeRequest('DELETE', 'https://www.googleapis.com/drive/v3/files/' + fileId);
        };

        /**
         * https://developers.google.com/drive/v3/web/about-auth
         * @param redirectUri
         * @returns {string}
         */
        var getAuthenticationUrl = function (redirectUri) {
            var securityToken = getSecurityToken();
            var params = {
                client_id: CLIENT_ID,
                redirect_uri: redirectUri,
                response_type: 'token',
                scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata',
                state: securityToken
            };
            var query = [];
            Object.keys(params).forEach(function (key) {
                query.push(key + '=' + encodeURIComponent(params[key]));
            });
            return 'https://accounts.google.com/o/oauth2/v2/auth?' + query.join('&');
        };

        /**
         * Gets random one time token
         * @returns {*}
         */
        var getSecurityToken = function () {
            var token = securityToken;
            if (!token) {
                token = Math.random().toString(36).substring(7);
            } else {
                securityToken = null;
            }

            return token;
        };

        return {
            uploadFile: uploadFile,
            downloadFile: downloadFile,
            getStartPageToken: getStartPageToken,
            listChanges: listChanges,
            listFiles: listFiles,
            revokeToken: revokeToken,
            deleteFile: deleteFile,
            getAuthenticationUrl: getAuthenticationUrl,
            getSecurityToken: getSecurityToken
        };

    })();

    function syncListFiles() {

        return GoogleDriveClient.listFiles()
            .then(function (response) {
                googleDriveFolderState.files = {};
                var files = response.files;
                for (var i = 0; i < files.length; i++) {
                    var file = files[i];
                    googleDriveFolderState.files[file.name] = file;
                }
            });
    }

    function syncListChanges() {

        var tokenPromise;
        if (googleDriveFolderState.startPageToken === null) {
            tokenPromise = GoogleDriveClient.getStartPageToken();
        } else {
            tokenPromise = Promise.resolve(googleDriveFolderState.startPageToken);
        }

        return tokenPromise.then(function (token) {
                googleDriveFolderState.startPageToken = token;
                return GoogleDriveClient.listChanges(token);
            })
            .then(function (response) {
                if (response.newStartPageToken) {
                    googleDriveFolderState.startPageToken = response.newStartPageToken;
                }
                var changes = response.changes || [];
                if (changes.length > 0 || googleDriveFolderState.files === null) {
                    adguard.listeners.notifyListeners(adguard.listeners.SYNC_REQUIRED);
                }
            });
    }

    function startPolling(timeout) {
        if (!accessToken) {
            adguard.console.info('Access token is empty. Stop polling changes...');
            return;
        }
        googleDriveFolderState.pollingTimeoutId = setTimeout(function () {
            syncListChanges()
                .then(function () {
                    startPolling(60 * 1000);
                })
                .catch(function (error) {
                    adguard.console.error('Google Drive sync error {0}', error);
                    startPolling(5 * 60 * 1000);
                });
        }, timeout || 0);
    }

    function getFileIdByName(name) {
        return syncListFiles().then(function () {
            var file = googleDriveFolderState.files[name];
            return file ? file.id : null;
        });
    }

    /**
     * Loads file content by name
     * @param name File name
     * @param callback
     */
    var load = function (name, callback) {
        getFileIdByName(name)
            .then(function (fileId) {
                if (fileId) {
                    return GoogleDriveClient.downloadFile(fileId);
                } else {
                    return Promise.resolve(null);
                }
            })
            .then(function (file) {
                callback(file);
            })
            .catch(function (error) {
                adguard.console.error('Google Drive sync error {0} {1}', name, error);
                callback(false);
            });
    };

    /**
     * Saves file
     * @param name File name
     * @param data File data
     * @param callback
     */
    var save = function (name, data, callback) {
        getFileIdByName(name)
            .then(function (fileId) {
                return GoogleDriveClient.uploadFile(fileId, name, data);
            })
            .then(function (file) {
                googleDriveFolderState.files[name] = file;
                callback(file);
            })
            .catch(function (error) {
                adguard.console.error('Google Drive sync error {0} {1}', name, error);
                callback(false);
            });
    };

    var isAuthorized = function () {
        if (!accessToken) {
            adguard.console.warn("Unauthorized! Please set access token first.");
            return false;
        }
        return true;
    };

    /**
     * Revokes Google Drive token
     */
    var logout = function () {
        GoogleDriveClient.revokeToken();
    };

    var init = function (token, securityToken) {
        if (securityToken) {
            if (securityToken !== GoogleDriveClient.getSecurityToken()) {
                adguard.console.warn("Security token doesn't match");
                return;
            }
        }

        if (token) {
            accessToken = token;
            adguard.localStorage.setItem(TOKEN_STORAGE_PROP, token);
        } else {
            accessToken = adguard.localStorage.getItem(TOKEN_STORAGE_PROP);
        }
        if (accessToken) {
            startPolling();
        } else {
            adguard.tabs.create({
                active: true,
                type: 'popup',
                url: GoogleDriveClient.getAuthenticationUrl('https://injections.adguard.com?provider=' + PROVIDER_NAME)
            });
        }
    };

    var shutdown = function () {
        clearTimeout(googleDriveFolderState.pollingTimeoutId);
        accessToken = null;
    };

    api.googleDriveSyncProvider = {
        get name() {
            return PROVIDER_NAME;
        },
        // Storage api
        load: load,
        save: save,
        init: init,
        shutdown: shutdown,
        // Auth api
        isAuthorized: isAuthorized,
        logout: logout
    };

})(adguard.sync, adguard);