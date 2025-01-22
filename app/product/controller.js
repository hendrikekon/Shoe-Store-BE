const path = require('path');
const fsp = require('fs').promises;
const fs = require('fs')
const Product = require('./model');
const config = require('../config');
const Category = require('../category/model');
const Brand = require('../brand/model');
const mongoose = require('mongoose');
const db = require('../../database');

// const fs = require('fs').promises; // Use fs.promises to access the promise-based methods

const store = async (req, res, next) => {
    try {
        let payload = req.body;

        // Convert category and brand names to ObjectIds
        if (payload.category) {
            const category = await Category.findOne({ name: { $regex: payload.category, $options: 'i' } });
            if (category) {
                payload.category = category._id;
            } else {
                delete payload.category;
            }
        }

        if (payload.brands) {
            const brand = await Brand.findOne({ name: { $regex: payload.brands, $options: 'i' } });
            if (brand) {
                payload.brands = brand._id;
            } else {
                delete payload.brands;
            }
        }

        // Process files dynamically and upload them using GridFS
        if (req.files && req.files.length > 0 && payload.colors) {
            payload.colors = JSON.parse(payload.colors);

            // Create a GridFS bucket instance
            const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'images' });

            await Promise.all(req.files.map(async (file, index) => {
                if (file && payload.colors[index]) {  // Ensure both file and color entry exist
                    const { filename, mimetype, path } = file;

                    // Create a read stream from the file path
                    const readStream = fs.createReadStream(path);

                    // Upload the file to GridFS
                    const uploadStream = bucket.openUploadStream(filename, { contentType: mimetype });
                    readStream.pipe(uploadStream);

                    return new Promise((resolve, reject) => {
                        // Once the file is uploaded to GridFS, associate the image with the corresponding color entry
                        uploadStream.on('finish', async () => {
                            try {
                                console.log('File uploaded successfully to GridFS with ID:', uploadStream.id);

                                // Associate the file with the corresponding color entry
                                payload.colors[index].image = uploadStream.id;

                                // Remove the temporary file after uploading
                                await fsp.unlink(path);

                                resolve();
                            } catch (err) {
                                console.error("Error associating image with color:", err);
                                bucket.delete(uploadStream.id);  // Clean up if there's an error
                                reject(err);
                            }
                        });

                        uploadStream.on('error', (err) => {
                            console.error("Error uploading file to GridFS:", err);
                            reject(err);
                        });
                    });
                } else {
                    console.warn(`File or color entry is missing at index ${index}`);
                }
            }));
        } else {
            console.log("No files or colors received.");
        }

        // Save product to the database after image processing
        const product = new Product(payload);
        await product.save();

        return res.status(200).json(product);


    } catch (err) {
        console.error("Error processing product:", err);
        res.status(400).json({
            error: 1,
            message: err.message,
            fields: err.errors
        });
        next(err);
    }
};

const getImage = (req, res) => {
    const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'images' });
    const { id } = req.params;

    bucket.openDownloadStream(new mongoose.Types.ObjectId(id))
        .on('error', () => res.status(404).send('Image not found'))
        .pipe(res);
};

const index = async (req, res, next) => {
    try {
        let { skip = 0, limit = 10, q = '', category = '', brands = '' } = req.query;

        let criteria = {};

        // for Search purpose. use product name if query parameter is provided
        if (q) {
            criteria.name = { $regex: q, $options: 'i' };
        }

        // Handle category filter only if category is not an empty string
        if (category && category.length) {
            let categoryResult = await Category.findOne({ name: { $regex: `${category}`, $options: 'i' } });

            if (categoryResult) {
                criteria = { ...criteria, category: categoryResult._id };
            }
        }

        // Handle brand filter only if brand is not an empty string
        if (brands && brands.length) {
            const brandResult = await Brand.findOne({ name: { $regex: `${brands}`, $options: 'i' } });
            if (brandResult) {
                criteria = { ...criteria, brands: brandResult._id };
            }
        }

        // Count the documents matching the criteria
        const count = await Product.countDocuments(criteria);

        // Fetch products based on the criteria
        const products = await Product.find(criteria)
            .sort({ createdAt: -1 })
            .skip(parseInt(skip))
            .limit(parseInt(limit))
            .populate('category')
            .populate('brands');

        // Return the response with product data and count
        return res.json({
            data: products,
            count
        });
    } catch (error) {
        next(error);
    }
};



const indexbyId = async (req, res) => {
    const productId = req.params.id;
    try {
        const product = await Product.findById(productId)
        .populate('category')
        .populate('brands');

        if (product) {
            return res.status(200).json(product);
        } else {
            res.status(404).send('Product not found');
        }
    } catch (error) {
        res.status(500).send(error);
    }
}


const update = async (req, res, next) => {
    try {
        const { id, colorId, sizeId } = req.params;
        let updateData = req.body;

        // Parse colors field if it is a string
        if (updateData.colors && typeof updateData.colors === 'string') {
            try {
                updateData.colors = JSON.parse(updateData.colors);
            } catch (error) {
                return res.status(400).json({ error: 'Invalid colors format' });
            }
        }

        // Find the product
        const product = await Product.findById(id);
        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Convert category and brand names to ObjectIds
        if (updateData.category) {
            const category = await Category.findOne({ name: { $regex: updateData.category, $options: 'i' } });
            if (category) {
                updateData.category = category._id;
            } else {
                delete updateData.category;
            }
        }

        if (updateData.brands) {
            const brand = await Brand.findOne({ name: { $regex: updateData.brands, $options: 'i' } });
            if (brand) {
                updateData.brands = brand._id;
            } else {
                delete updateData.brands;
            }
        }

        // Handle file uploads and update the corresponding color image if colorId is provided
        if (req.files && req.files.length > 0) {
            const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'images' });
        
            await Promise.all(req.files.map(async (file, index) => {
                const { filename, mimetype, path: tempPath } = file;
        
                // Delete old image from GridFS if it exists
                const oldImageId = product.colors[index]?.image;
                if (oldImageId) {
                    try {
                        await bucket.delete(new mongoose.Types.ObjectId(oldImageId));
                    } catch (error) {
                        console.warn(`Warning: Could not delete old GridFS file: ${oldImageId}`);
                    }
                }
        
                // Upload the new image to GridFS
                const uploadStream = bucket.openUploadStream(filename, { contentType: mimetype });
                const readStream = fs.createReadStream(tempPath);
        
                readStream.pipe(uploadStream);
        
                await new Promise((resolve, reject) => {
                    uploadStream.on('finish', async () => {
                        try {
                            // console.log('File uploaded successfully to GridFS:', uploadStream.id);
        
                            // Associate with the corresponding color entry
                            if (updateData.colors && updateData.colors[index]) {
                                updateData.colors[index].image = uploadStream.id.toString(); // Use GridFS ObjectId as a string
                            }
        
                            // Remove the temporary file
                            await fsp.unlink(tempPath);
        
                            resolve();
                        } catch (error) {
                            // console.error('Error associating image:', error);
                            bucket.delete(uploadStream.id); // Rollback GridFS upload
                            reject(error);
                        }
                    });
        
                    uploadStream.on('error', (error) => {
                        // console.error('Error uploading to GridFS:', error);
                        reject(error);
                    });
                });
            }));
        }

        // Update colors and sizes based on parameters
        if (colorId) {
            const color = product.colors.id(colorId);
            if (!color) return res.status(404).json({ error: 'Color not found' });

            if (sizeId) {
                const size = color.sizes.id(sizeId);
                if (size) {
                    Object.assign(size, updateData); // Update size data
                } else {
                    color.sizes.push(updateData); // Add new size if it doesn't exist
                }
            } else {
                Object.assign(color, updateData); // Update color data
            }
        } else {
            // If no colorId, update product-level data directly
            Object.assign(product, updateData);
        }

        // Save updates to the product
        await product.save();
        return res.json(product);
        
    } catch (error) {
        console.error("Error updating product:", error);
        res.status(400).json({
            error: 1,
            message: error.message,
            fields: error.errors
        });
        next(error);
    }
};








const destroy = async (req, res) => {
    const { id } = req.params;
    try {
        // Find product by ID
        const imgproduct = await Product.findById(id);

        if (!imgproduct) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // Access Gridfs Bucket
        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'images' });

        // Loop through the colors array and delete each image
        if (imgproduct.colors && imgproduct.colors.length > 0) {
            for (const color of imgproduct.colors) {
                if (color.image) {
                    try {
                        await bucket.delete(new mongoose.Types.ObjectId(color.image));
                        // console.log(`Image for color ${color.color} deleted successfully from GridFS`);
                    } catch (err) {
                        res.status(400).json({ 
                            error: 1,
                            message: error.message,
                            fields: error.errors
                        });
                        // console.error(`Error deleting image for color ${color.color} from GridFS:`, err);
                    }
                }
            }
        } else {
            console.log('No colors found for product');
        }

        // Delete the product from the database
        await Product.findByIdAndDelete(id);
        res.status(200).json({ message: 'Product deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            error: 1,
            message: error.message,
            fields: error.errors
        });
    }
};



module.exports = {
    index,
    indexbyId,
    store,
    update,
    destroy,
    getImage,
}