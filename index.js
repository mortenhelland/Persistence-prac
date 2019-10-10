const express = require('express')
const responseTime = require('response-time')
const axios = require('axios')
const redis = require('redis')
const AWS = require('aws-sdk')
 
const bucketName = 'mortenhelland-wikipedia-store'
 
const apiVersion = { apiVersion: '2006-03-01' }
 
;(async () => {
    try {
        await new AWS.S3(apiVersion).createBucket({ Bucket: bucketName }).promise()
        console.log('Successfully created ' + bucketName)
    } catch (e) {
        console.error('Could not connect to S3')
    }
})()
 
const app = express()
app.use(responseTime())
 
const redisClient = redis.createClient()
redisClient.on('error', err => {
    console.log('Error ' + err)
})
 
app.get('/api/search', (req, res) => {
    const query = req.query.query.trim()
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=parse&format=json&section=0&page=${query}`
    const redisKey = `wikipedia:${query}`
    const s3Key = `wikipedia-${query}`
 
    redisClient.get(redisKey, async (err, result) => {
        if (result) {
            res.status(200).json({ source: 'Redis Cache', ...JSON.parse(result) })
        } else {
            new AWS.S3(apiVersion).getObject(
                { Bucket: bucketName, Key: s3Key },
                async (err, result) => {
                    if (result) {
                        res
                            .status(200)
                            .json({ source: 'S3 Bucket', ...JSON.parse(result.Body) })
                    } else {
                        response = await getWiki(searchUrl)
                        await setS3(s3Key, response)
                        redisClient.setex(
                            redisKey,
                            3600,
                            JSON.stringify({ source: 'Redis Cache', ...response }),
                            () => console.log('Successfully stored data in redis')
                        )
                        res.status(200).json({ source: 'Wikipedia API', ...response })
                    }
                }
            )
        }
    })
})
 
const setS3 = async (s3Key, responseJSON) => {
    const body = JSON.stringify({
        source: 'S3 Bucket',
        ...responseJSON
    })
    const objectParams = {
        Bucket: bucketName,
        Key: s3Key,
        Body: body
    }
    await new AWS.S3(apiVersion).putObject(objectParams).promise()
    console.log('Successfully uploaded data to ' + bucketName + '/' + s3Key)
}
 
const getWiki = async searchUrl => {
    const response = await axios.get(searchUrl)
    return response.data
}
 
app.get('/api/store', (req, res) => {
    const key = req.query.key.trim()
 
    // Construct the wiki URL and S3 key
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=parse&format=json&section=0&page=${key}`
    const s3Key = `wikipedia-${key}`
    const params = { Bucket: bucketName, Key: s3Key }
 
    return new AWS.S3(apiVersion).getObject(params, (err, result) => {
        if (result) {
            // Serve from S3
            console.log(result)
            const resultJSON = JSON.parse(result.Body)
            return res.status(200).json(resultJSON)
        } else {
            // Serve from Wikipedia API and store in S3
            return axios
                .get(searchUrl)
                .then(response => {
                    const responseJSON = response.data
                    const body = JSON.stringify({
                        source: 'S3 Bucket',
                        ...responseJSON
                    })
                    const objectParams = { Bucket: bucketName, Key: s3Key, Body: body }
                    const uploadPromise = new AWS.S3(apiVersion)
                        .putObject(objectParams)
                        .promise()
 
                    uploadPromise.then(function(data) {
                        console.log(
                            'Successfully uploaded data to ' + bucketName + '/' + s3Key
                        )
                    })
                    return res
                        .status(200)
                        .json({ source: 'Wikipedia API', ...responseJSON })
                })
                .catch(err => {
                    return res.json(err)
                })
        }
    })
})
 
app.listen(3000, () => {
    console.log('Server listening on port: 3000')
})