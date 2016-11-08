'use strict';

const qiniu = require('qiniu');
const path = require('path');
const ora = require('ora');

module.exports = class QiniuPlugin {
  constructor(options) {
    this.options = Object.assign({}, options);
    qiniu.conf.ACCESS_KEY = this.options.accessKey;
    qiniu.conf.SECRET_KEY = this.options.secretKey;
    qiniu.conf.AUTOZONE = options.autoZone !== false;
  }

  apply(compiler) {
    compiler.plugin('after-emit', (compilation, callback) => {

      let assets = compilation.assets;
      let hash = compilation.hash;
      let bucket = this.options.bucket;
      let uploadPath = this.options.path || '[hash]';

      uploadPath = uploadPath.replace('[hash]', hash);

      let filesNames = Object.keys(assets);
      let totalFiles = filesNames.length;
      let uploadedFiles = 0;
      let promises = [];

      // eslint-disable-next-line no-console
      console.log('\n');
      let spinner = ora({
        text: `Uploading to Qiniu CDN: 0% 0/${totalFiles} modules uploaded`,
        color: 'green'
      }).start();

      let _finish = (err) => {
        spinner.succeed();
        // eslint-disable-next-line no-console
        console.log('\n');
        callback(err);
      };

      filesNames.map(fileName => {
        let file = assets[fileName] || {};
        if (!file.emitted) return;

        let key = path.join(uploadPath, fileName);
        let token = new qiniu.rs.PutPolicy(`${bucket}:${key}`).token();
        let extra = new qiniu.io.PutExtra();

        let promise = new Promise((resolve, reject) => {
          let begin = Date.now();
          qiniu.io.putFile(token, key, file.existsAt, extra, function (err, ret) {
            uploadedFiles++;
            spinner.text = `Uploading to Qiniu: ${Math.round(uploadedFiles / totalFiles * 100)}% ${uploadedFiles}/${totalFiles} modules uploaded`;

            if (err) return reject(err);
            ret.duration = Date.now() - begin;
            resolve(ret);
          });
        });

        promises.push(promise);
      });

      Promise.all(promises).then(() => _finish()).catch(_finish);
    });
  }
};
