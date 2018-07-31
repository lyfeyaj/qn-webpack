'use strict';

const qiniu = require('qiniu');
const path = require('path');
const ora = require('ora');
const isRegExp = require('lodash.isregexp');
const isString = require('lodash.isstring');

// Constants
const REGEXP_HASH = /\[hash(?::(\d+))?\]/gi;

// Uploading progress tip
const tip = (uploaded, total) => {
  let percentage = Math.round(uploaded / total * 100);
  return `Uploading to Qiniu CDN: ${percentage}% ${uploaded}/${total} files uploaded`;
};

// Replace path variable by hash with length
const withHashLength = (replacer) => {
  return function(_, hashLength) {
    const length = hashLength && parseInt(hashLength, 10);
    const hash = replacer.apply(this, arguments);
    return length ? hash.slice(0, length) : hash;
  };
};

// Perform hash replacement
const getReplacer = (value, allowEmpty) => {
  return function(match) {
    // last argument in replacer is the entire input string
    const input = arguments[arguments.length - 1];
    if(value === null || value === undefined) {
      if(!allowEmpty) throw new Error(`Path variable ${match} not implemented in this context of qn-webpack plugin: ${input}`);
      return '';
    } else {
      return `${value}`;
    }
  };
};

module.exports = class QiniuPlugin {
  constructor(options) {
    this.options = Object.assign({}, options);
    this.options.path = this.options.path == null ? '[hash]' : this.options.path;
    if (!isString(this.options.path)) throw new Error('qn-webpack plugin: path is invalid');
  }

  apply(compiler) {
    const uploadFiles = (compilation, callback) => {

      let assets = compilation.assets;
      let hash = compilation.hash;
      let exclude = isRegExp(this.options.exclude) && this.options.exclude;
      let include = isRegExp(this.options.include) && this.options.include;
      let batch = this.options.batch || 20;
      let mac = new qiniu.auth.digest.Mac(this.options.accessKey, this.options.secretKey);
      let qiniuConfig = new qiniu.conf.Config();
      let bucket = this.options.bucket;
      let zone = qiniu.zone[this.options.zone];
      if (zone) qiniuConfig.zone = zone;
      let uploadPath = this.options.path;
      uploadPath = uploadPath.replace(REGEXP_HASH, withHashLength(getReplacer(hash)));

      let filesNames = Object.keys(assets);
      let totalFiles = 0;
      let uploadedFiles = 0;

      // Mark finished
      let _finish = (err) => {
        spinner.succeed();
        // eslint-disable-next-line no-console
        console.log('\n');
        callback(err);
      };

      // Filter files that should be uploaded to Qiniu CDN
      filesNames = filesNames.filter(fileName => {
        let file = assets[fileName] || {};

        // Ignore unemitted files
        if (!file.emitted) return false;

        // Check excluced files
        if (exclude && exclude.test(fileName)) return false;

        // Check included files
        if (include) return include.test(fileName);

        return true;
      });

      totalFiles = filesNames.length;

      // eslint-disable-next-line no-console
      console.log('\n');
      let spinner = ora({
        text: tip(0, totalFiles),
        color: 'green'
      }).start();

      // Perform upload to qiniu
      const performUpload =function(fileName) {
        let file = assets[fileName] || {};
        let key = path.posix.join(uploadPath, fileName);
        let putPolicy = new qiniu.rs.PutPolicy({ scope: bucket + ':' + key });
        let uploadToken = putPolicy.uploadToken(mac);
        let formUploader = new qiniu.form_up.FormUploader(qiniuConfig);
        let putExtra = new qiniu.form_up.PutExtra();

        return new Promise((resolve, reject) => {
          let begin = Date.now();
          formUploader.putFile(uploadToken, key, file.existsAt, putExtra, function(err, body) {
            uploadedFiles++;
            spinner.text = tip(uploadedFiles, totalFiles);

            if (err) return reject(err);
            body.duration = Date.now() - begin;
            resolve(body);
          });
        });
      };

      // Execute stack according to `batch` option
      const execStack = function(err) {
        if (err) {
          // eslint-disable-next-line no-console
          console.log('\n');
          return Promise.reject(err);
        }

        // Get batch files
        let _files = filesNames.splice(0, batch);

        if (_files.length) {
          return Promise.all(
            _files.map(performUpload)
          ).then(() => execStack(), execStack);
        } else {
          return Promise.resolve();
        }
      };

      execStack().then(() => _finish(), _finish);
    };

    // For webpack >= 4
    if (compiler.hooks) {
      compiler.hooks.afterEmit.tapAsync('QiniuWebpackPlugin', uploadFiles);
    }
    // For webpack < 4
    else {
      compiler.plugin('after-emit', uploadFiles);
    }
  }
};
